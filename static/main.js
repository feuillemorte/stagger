/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */

"use strict";

const gesso = new Gesso();

class Stagger {
    constructor() {
        this.request = {
            path: null,
            query: {}
        };

        this.renderTime = null;
        this.data = null;

        window.addEventListener("statechange", (event) => {
            this.render();
        });

        window.addEventListener("load", (event) => {
            this.request.path = window.location.pathname;

            if (window.location.search) {
                this.request.query = gesso.parseQueryString(window.location.search);
            }

            window.history.replaceState(this.request, "", window.location.href);

            this.fetchDataPeriodically();

            //window.setInterval(() => { this.checkFreshness }, 60 * 1000);
        });

        window.addEventListener("popstate", (event) => {
            this.request = event.state;
            window.dispatchEvent(new Event("statechange"));
        });
    }

    fetchDataPeriodically() {
        gesso.fetchPeriodically("/api/data", (data) => {
            this.data = data;
            window.dispatchEvent(new Event("statechange"));
        });
    }

    createStateChangeLink(parent, href, options) {
        let elem = gesso.createLink(parent, href, options);

        elem.addEventListener("click", (event) => {
            event.preventDefault();

            this.request.path = new URL(event.target.href).pathname;
            this.fetchDataPeriodically();

            window.history.pushState(this.request, "", event.target.href);
            window.dispatchEvent(new Event("statechange"));
        });

        return elem;
    }

    createOptionalLink(parent, href, text, nullValue) {
        if (!text) {
            text = nullValue;
        }

        if (href) {
            return gesso.createLink(parent, href, text);
        } else {
            return gesso.createText(parent, text);
        }
    }

    createCommitLink(parent, href, id, nullValue) {
        if (id && id.length > 8) {
            id = id.substring(0, 7);
        }

        return this.createOptionalLink(parent, href, id, nullValue);
    }

    createJsonBlock(parent, data) {
        let json = JSON.stringify(data, null, 4);
        let pre = gesso.createElement(parent, "pre", {"text": json, "class": "json"});

        if (hljs) {
            hljs.highlightBlock(pre);
        }

        return pre;
    }

    createArtifactCoordinates(parent, data) {
        let coords;

        switch (data["type"]) {
        case "container":
            coords = `${data["repository"]}/${data["image_id"]}`;
            break;
        case "file":
            try {
                coords = new URL(data["url"]).pathname;
                coords = coords.substr(coords.lastIndexOf("/") + 1);
            } catch {
                coords = "-"
            }

            break;
        case "maven":
            coords = `${data["group_id"]}:${data["artifact_id"]}:${data["version"]}`;
            break;
        case "rpm":
            coords = `${data["name"]}-${data["version"]}-${data["release"]}`;
            break;
        default:
            coords = "-";
        }

        return gesso.createText(parent, coords);
    }

    render() {
        console.log(`Rendering ${this.request.path}`);

        this.renderTime = new Date().getTime();

        let content = gesso.createDiv(null, "#content");
        let prefix = this.request.path.split("/", 2)[1];

        switch(prefix) {
        case "tags":
            this.renderTagView(content);
            break;
        case "artifacts":
            this.renderArtifactView(content);
            break;
        default:
            this.renderMainView(content);
        }

        gesso.replaceElement($("#content"), content);
    }

    renderHeader(parent, title, navLinks) {
        let nav = gesso.createElement(parent, "nav", {"class": "context"});

        for (let [href, title] of navLinks.slice(0, -1)) {
            this.createStateChangeLink(nav, href, title);
            gesso.createText(nav, " \xa0>\xa0 ");
        }

        gesso.createText(nav, navLinks[navLinks.length - 1]);
        gesso.createElement(parent, "h1", title);
    }

    renderFooter(parent) {
        let elem = gesso.createElement(parent, "nav", {"class": "footer"});

        gesso.createLink(elem, "/docs.html", "Documentation");
    }

    renderMainView(parent) {
        let repos = this.data["repos"];

        gesso.createElement(parent, "h1", "Stagger");

        let headings = ["Tag", "Build", "Commit", "Updated"];
        let rows = [];

        for (let repoId of Object.keys(repos)) {
            let repo = repos[repoId];

            for (let branchId of Object.keys(repo["branches"])) {
                let branch = repo["branches"][branchId];

                for (let tagId of Object.keys(branch["tags"])) {
                    let tag = `${repoId}/${branchId}/${tagId}`
                    let tagData = this.data["repos"][repoId]["branches"][branchId]["tags"][tagId];
                    let tagViewPath = `/tags/${repoId}/${branchId}/${tagId}`

                    rows.push([
                        this.createStateChangeLink(null, tagViewPath, tag),
                        this.createOptionalLink(null, tagData["build_url"], tagData["build_id"], "-"),
                        this.createCommitLink(null, tagData["commit_url"], tagData["commit_id"], "-"),
                        "-"
                    ]);
                }
            }
        }

        gesso.createTable(parent, headings, rows);

        this.renderFooter(parent);
    }

    renderTagView(parent) {
        let [repoId, branchId, tagId] = this.request.path.split("/", 5).slice(2);
        let tag = `${repoId}/${branchId}/${tagId}`
        let data = this.data["repos"][repoId]["branches"][branchId]["tags"][tagId];

        this.renderHeader(parent, tag, [["/", "Stagger"], `Tag ${tag}`]);

        let url = new URL(window.location.href);
        let apiPath = `api/repos/${repoId}/branches/${branchId}/tags/${tagId}`
        let apiUrl = `${url.origin}/${apiPath}`
        let eventPath = `events/${repoId}/${branchId}/${tagId}`
        let eventUrl = `amqp://${url.hostname}:5672/${eventPath}`

        gesso.createElement(parent, "h2", "Properties");

        let props = [
            ["API URL", gesso.createLink(null, apiUrl, apiUrl)],
            ["Event URL", gesso.createLink(null, eventUrl, eventUrl)],
            ["Build", this.createOptionalLink(null, data["build_url"], data["build_id"], "-")],
            ["Commit", this.createOptionalLink(null, data["commit_url"], data["commit_id"], "-")],
            ["Updated", "-"]
        ];

        gesso.createFieldTable(parent, props, {"class": "fields"});

        gesso.createElement(parent, "h2", "Artifacts");

        let headings = ["Artifacts", "Type", "Coordinates"];
        let rows = [];

        for (let artifactId of Object.keys(data["artifacts"])) {
            let artifact = data["artifacts"][artifactId];

            rows.push([
                this.createStateChangeLink(null, `/artifacts/${tag}/${artifactId}`, artifactId),
                artifact["type"],
                this.createArtifactCoordinates(null, artifact)
            ]);
        }

        gesso.createTable(parent, headings, rows);

        gesso.createElement(parent, "h2", "Example commands");

        let commands = [
            ["Get data", gesso.createElement(null, "code", `curl ${apiUrl}`)],
            ["Create or update", gesso.createElement(null, "code", `curl -X PUT ${apiUrl} -d @data.json`)],
            ["Delete", gesso.createElement(null, "code", `curl -X DELETE ${apiUrl}`)],
            ["Check for updates", gesso.createElement(null, "code", `curl --head -H 'If-None-Match: <etag>' ${apiUrl}`)],
            ["Listen for events", gesso.createElement(null, "code", `qreceive ${eventUrl}`)]
        ];

        gesso.createFieldTable(parent, commands, {"class": "fields"});

        gesso.createElement(parent, "h2", "Data");

        this.createJsonBlock(parent, data);

        this.renderFooter(parent);
    }

    renderArtifactView(parent) {
        let [repoId, branchId, tagId, artifactId] = this.request.path.split("/", 6).slice(2);
        let tag = `${repoId}/${branchId}/${tagId}`
        let data = this.data["repos"][repoId]["branches"][branchId]["tags"][tagId]["artifacts"][artifactId];

        this.renderHeader(parent, artifactId, [["/", "Stagger"], [`/tags/${tag}`, `Tag ${tag}`], `Artifact ${artifactId}`]);

        let url = new URL(window.location.href);
        let apiPath = `api/repos/${repoId}/branches/${branchId}/tags/${tagId}/artifacts/${artifactId}`
        let apiUrl = `${url.origin}/${apiPath}`
        let eventPath = `events/${repoId}/${branchId}/${tagId}/${artifactId}`
        let eventUrl = `amqp://${url.hostname}:5672/${eventPath}`

        gesso.createElement(parent, "h2", "Properties");

        let props = [
            ["API URL", gesso.createLink(null, apiUrl, apiUrl)],
            ["Event URL", gesso.createLink(null, eventUrl, eventUrl)],
            ["Type", data["type"]]
        ];

        switch (data["type"]) {
        case "container":
            props.push(...[
                ["Registry URL", this.createOptionalLink(null, data["registry_url"], data["registry_url"])],
                ["Repository", data["repository"]],
                ["Image", data["image_id"]]
            ]);
            break;
        case "file":
            props.push(["URL", this.createOptionalLink(null, data["url"], data["url"])]);
            break;
        case "maven":
            props.push(...[
                ["Repository URL", this.createOptionalLink(null, data["repository_url"], data["repository_url"])],
                ["Group", data["group_id"]],
                ["Artifact", data["artifact_id"]],
                ["Version", data["version"]]
            ]);
            break;
        case "rpm":
            props.push(...[
                ["Repository URL", this.createOptionalLink(null, data["repository_url"], data["repository_url"])],
                ["Name", data["name"]],
                ["Version", data["version"]],
                ["Release", data["release"]]
            ]);
            break;
        }

        props.push(["Updated", "-"]);

        gesso.createFieldTable(parent, props, {"class": "fields"});

        gesso.createElement(parent, "h2", "Example commands");

        let commands = [
            ["Get data", gesso.createElement(null, "code", `curl ${apiUrl}`)],
            ["Create or update", gesso.createElement(null, "code", `curl -X PUT ${apiUrl} -d @data.json`)],
            ["Delete", gesso.createElement(null, "code", `curl -X DELETE ${apiUrl}`)],
            ["Check for updates", gesso.createElement(null, "code", `curl --head -H 'If-None-Match: <etag>' ${apiUrl}`)],
            ["Listen for events", gesso.createElement(null, "code", `qreceive ${eventUrl}`)]
        ];

        gesso.createFieldTable(parent, commands, {"class": "fields"});

        gesso.createElement(parent, "h2", "Data");

        this.createJsonBlock(parent, data);

        this.renderFooter(parent);
    }
}
