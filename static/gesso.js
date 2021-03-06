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

const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

Element.prototype.$ = function () {
  return this.querySelector.apply(this, arguments);
};

Element.prototype.$$ = function () {
  return this.querySelectorAll.apply(this, arguments);
};

class Gesso {
    constructor({minFetchInterval = 500, maxFetchInterval = 10 * 60 * 1000} = {}) {
        this._minFetchInterval = minFetchInterval;
        this._maxFetchInterval = maxFetchInterval;
        this._fetchStates = new Map(); // By path
    }

    openRequest(method, url, loadHandler) {
        let request = new XMLHttpRequest();

        request.open(method, url);

        if (loadHandler != null) {
            request.addEventListener("load", loadHandler);
        }

        return request;
    }

    _getFetchState(path) {
        let state = this._fetchStates[path];

        if (state == null) {
            state = {
                currentInterval: null,
                currentTimeoutId: null,
                failedAttempts: 0,
                etag: null,
                timestamp: null
            };

            this._fetchStates[path] = state;
        }

        return state;
    }

    fetch(path, dataHandler) {
        console.log("Fetching data from", path);

        let state = this._getFetchState(path);

        let request = this.openRequest("GET", path, (event) => {
            if (event.target.status >= 200 && event.target.status < 300) {
                state.failedAttempts = 0;
                state.etag = event.target.getResponseHeader("ETag");

                dataHandler(JSON.parse(event.target.responseText));
            } else if (event.target.status == 304) {
                state.failedAttempts = 0;
            }

            state.timestamp = new Date().getTime();
        });

        request.addEventListener("error", (event) => {
            console.log("Fetch failed");
            state.failedAttempts++;
        });

        let etag = state.etag;

        if (etag) {
            request.setRequestHeader("If-None-Match", etag);
        }

        request.send();

        return state;
    }

    fetchPeriodically(path, dataHandler) {
        let state = this._getFetchState(path);

        clearTimeout(state.currentTimeoutId);
        state.currentInterval = this._minFetchInterval;

        this._doFetchPeriodically(path, dataHandler, state);

        return state;
    }

    _doFetchPeriodically(path, dataHandler, state) {
        if (state.currentInterval >= this._maxFetchInterval) {
            setInterval(() => {
                this.fetch(path, dataHandler);
            }, this._maxFetchInterval);

            return;
        }

        state.currentTimeoutId = setTimeout(() => {
            this._doFetchPeriodically(path, dataHandler, state);
        }, state.currentInterval);

        state.currentInterval = Math.min(state.currentInterval * 2, this._maxFetchInterval);

        this.fetch(path, dataHandler);
    }

    parseQueryString(str) {
        if (str.startsWith("?")) {
            str = str.slice(1);
        }

        let qvars = str.split(/[&;]/);
        let obj = {};

        for (let i = 0; i < qvars.length; i++) {
            let [name, value] = qvars[i].split("=", 2);

            name = decodeURIComponent(name);
            value = decodeURIComponent(value);

            obj[name] = value;
        }

        return obj;
    }

    emitQueryString(obj) {
        let tokens = [];

        for (let name in obj) {
            if (!obj.hasOwnProperty(name)) {
                continue;
            }

            let value = obj[name];

            name = decodeURIComponent(name);
            value = decodeURIComponent(value);

            tokens.push(name + "=" + value);
        }

        return tokens.join(";");
    }

    createElement(parent, tag, options) {
        let elem = document.createElement(tag);

        if (parent != null) {
            parent.appendChild(elem);
        }

        if (options != null) {
            if (typeof options === "string" || typeof options === "number") {
                this.createText(elem, options);
            } else if (typeof options === "object") {
                if (options.hasOwnProperty("text")) {
                    let text = options["text"];

                    if (text != null) {
                        this.createText(elem, text);
                    }

                    delete options["text"];
                }

                for (let key of Object.keys(options)) {
                    elem.setAttribute(key, options[key]);
                }
            } else {
                throw `illegal argument: ${options}`;
            }
        }

        return elem;
    }

    createText(parent, text) {
        let node = document.createTextNode(text);

        if (parent != null) {
            parent.appendChild(node);
        }

        return node;
    }

    _setSelector(elem, selector) {
        if (selector == null) {
            return;
        }

        if (selector.startsWith("#")) {
            elem.setAttribute("id", selector.slice(1));
        } else {
            elem.setAttribute("class", selector);
        }
    }

    createDiv(parent, selector, options) {
        let elem = this.createElement(parent, "div", options);

        this._setSelector(elem, selector);

        return elem;
    }

    createSpan(parent, selector, options) {
        let elem = this.createElement(parent, "span", options);

        this._setSelector(elem, selector);

        return elem;
    }

    createLink(parent, href, options) {
        let elem = this.createElement(parent, "a", options);

        if (href != null) {
            elem.setAttribute("href", href);
        }

        return elem;
    }

    createTable(parent, headings, rows, options) {
        let elem = this.createElement(parent, "table", options);
        let thead = this.createElement(elem, "thead");
        let tbody = this.createElement(elem, "tbody");

        if (headings) {
            let tr = this.createElement(thead, "tr");

            for (let heading of headings) {
                this.createElement(tr, "th", heading);
            }
        }

        for (let row of rows) {
            let tr = this.createElement(tbody, "tr");

            for (let cell of row) {
                let td = this.createElement(tr, "td");

                if (cell instanceof Node) {
                    td.appendChild(cell);
                } else {
                    this.createText(td, cell);
                }
            }
        }

        return elem;
    }

    createFieldTable(parent, fields, options) {
        let elem = this.createElement(parent, "table", options);
        let tbody = this.createElement(elem, "tbody");

        for (let field of fields) {
            let tr = this.createElement(tbody, "tr");
            let th = this.createElement(tr, "th", field[0]);
            let td = this.createElement(tr, "td");

            if (field[1] instanceof Node) {
                td.appendChild(field[1]);
            } else {
                this.createText(td, field[1]);
            }
        }

        return elem;
    }

    replaceElement(oldElement, newElement) {
        oldElement.parentNode.replaceChild(newElement, oldElement);
    }

    formatDuration(millis, suffixes) {
        if (millis == null) {
            return "-";
        }

        if (suffixes == null) {
            suffixes = [
                " years",
                " weeks",
                " days",
                " hours",
                " minutes",
                " seconds",
                " millis",
            ];
        }

        let prefix = "";

        if (millis < 0) {
            prefix = "-";
        }

        millis = Math.abs(millis);

        let seconds = Math.round(millis / 1000);
        let minutes = Math.round(millis / 60 / 1000);
        let hours = Math.round(millis / 3600 / 1000);
        let days = Math.round(millis / 86400 / 1000);
        let weeks = Math.round(millis / 432000 / 1000);
        let years = Math.round(millis / 31536000 / 1000);

        if (years > 1)   return `${prefix}${years}${suffixes[0]}`;
        if (weeks > 1)   return `${prefix}${weeks}${suffixes[1]}`;
        if (days > 1)    return `${prefix}${days}${suffixes[2]}`;
        if (hours > 1)   return `${prefix}${hours}${suffixes[3]}`;
        if (minutes > 1) return `${prefix}${minutes}${suffixes[4]}`;
        if (seconds > 1) return `${prefix}${seconds}${suffixes[5]}`;
        if (millis == 0) return "0";

        return `${prefix}${Math.round(millis)}${suffixes[6]}`;
    }

    formatDurationBrief(millis) {
        return this.formatDuration(millis, ["y", "w", "d", "h", "m", "s", "ms"]);
    }
}
