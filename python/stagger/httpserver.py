#
# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
#

import json as _json
import json.decoder as _json_decoder
import logging as _logging
import os as _os
import starlette.requests as _requests
import starlette.responses as _responses
import starlette.routing as _routing
import starlette.staticfiles as _staticfiles
import uuid as _uuid
import uvicorn as _uvicorn

from .model import BadDataError

_log = _logging.getLogger("httpserver")

class HttpServer:
    def __init__(self, app, host="0.0.0.0", port=8080):
        self.app = app
        self.host = host
        self.port = port

        static_dir = _os.path.join(self.app.home, "static")

        routes = [
            _routing.Route("/api/data",
                           endpoint=_ModelHandler, methods=["GET", "HEAD"]),
            _routing.Route("/api/repos/{repo_id}",
                           endpoint=_RepoHandler, methods=["PUT", "DELETE", "GET", "HEAD"]),
            _routing.Route("/api/repos/{repo_id}/branches/{branch_id}",
                           endpoint=_BranchHandler, methods=["PUT", "DELETE", "GET", "HEAD"]),
            _routing.Route("/api/repos/{repo_id}/branches/{branch_id}/tags/{tag_id}",
                           endpoint=_TagHandler, methods=["PUT", "DELETE", "GET", "HEAD"]),
            _routing.Route("/api/repos/{repo_id}/branches/{branch_id}/tags/{tag_id}/artifacts/{artifact_id}",
                           endpoint=_ArtifactHandler, methods=["PUT", "DELETE", "GET", "HEAD"]),
            _routing.Route("/", endpoint=_IndexHandler, methods=["GET", "HEAD"]),
            _routing.Mount("", app=_staticfiles.StaticFiles(directory=static_dir)),
        ]

        self._router = _Router(self.app, routes)

    def run(self):
        _uvicorn.run(self._router, host=self.host, port=self.port, log_level="info")

class _Router(_routing.Router):
    def __init__(self, app, routes):
        super().__init__(routes)
        self.app = app

    def __call__(self, scope):
        scope["app"] = self.app
        return super().__call__(scope)

class _NotFoundResponse(_responses.PlainTextResponse):
    def __init__(self, exception):
        super().__init__(f"Not found: {exception}", 404)

class _NotModifiedResponse(_responses.PlainTextResponse):
    def __init__(self):
        super().__init__("Not modified", 304)

class _BadJsonResponse(_responses.PlainTextResponse):
    def __init__(self, exception):
        super().__init__(f"Bad request: Failure decoding JSON: {exception}", 400)

class _BadDataResponse(_responses.PlainTextResponse):
    def __init__(self, exception):
        super().__init__(f"Bad request: Illegal data: {exception}", 400)

class _AsgiHandler:
    def __init__(self, scope):
        self.scope = scope

    async def __call__(self, receive, send):
        request = _requests.Request(self.scope, receive)
        request.app = request["app"]

        try:
            response = await self.process(request)
        except KeyError as e:
            response = _NotFoundResponse(e)
        except BadDataError as e:
            response = _BadDataResponse(e)
        except _json_decoder.JSONDecodeError as e:
            response = _BadJsonResponse(e)

        if response is not None:
            await response(receive, send)
            return

        server_etag = self.etag(request)
        client_etag = request.headers.get("If-None-Match")

        if client_etag is not None and server_etag is not None:
            if client_etag == server_etag:
                response = _NotModifiedResponse()
                await response(receive, send)
                return

        response = await self.render(request)

        assert response is not None

        if server_etag is not None:
            response.headers["ETag"] = server_etag

        await response(receive, send)

    async def process(self, request):
        pass

    def etag(self, request):
        pass

    async def render(self, request):
        pass

class _IndexHandler(_AsgiHandler):
    _etag = f'"{str(_uuid.uuid4())}"'

    def etag(self, request):
        return self._etag

    async def render(self, request):
        return _responses.FileResponse(path=_os.path.join(request.app.home, "static", "index.html"))

class _ModelHandler(_AsgiHandler):
    def etag(self, request):
        return f'"{str(request.app.model.revision)}"'

    async def render(self, request):
        return _responses.JSONResponse(request.app.model.data())

class _ModelObjectHandler(_AsgiHandler):
    def etag(self, request):
        return f'"{str(request.object._digest)}"'

    def process_head(self, request):
        assert request.method == "HEAD"

        response = _responses.Response("")
        response.headers["ETag"] = self.etag(request)

        return response

    async def render(self, request):
        return _responses.JSONResponse(request.object.data())

class _RepoHandler(_ModelObjectHandler):
    async def process(self, request):
        model = request.app.model
        repo_id = request.path_params["repo_id"]

        if request.method == "PUT":
            repo_data = await request.json()
            model.put_repo(repo_id, repo_data)
            return _responses.Response("OK\n")

        if request.method == "DELETE":
            model.delete_repo(repo_id)
            return _responses.Response("OK\n")

        request.object = model.repos[repo_id]

        if request.method == "HEAD":
            return self.process_head(request)

class _BranchHandler(_ModelObjectHandler):
    async def process(self, request):
        model = request.app.model
        repo_id = request.path_params["repo_id"]
        branch_id = request.path_params["branch_id"]

        if request.method == "PUT":
            branch_data = await request.json()
            model.put_branch(repo_id, branch_id, branch_data)
            return _responses.Response("OK\n")

        if request.method == "DELETE":
            model.delete_branch(repo_id, branch_id)
            return _responses.Response("OK\n")

        request.object = model.repos[repo_id].branches[branch_id]

        if request.method == "HEAD":
            return self.process_head(request)

class _TagHandler(_ModelObjectHandler):
    async def process(self, request):
        model = request.app.model
        repo_id = request.path_params["repo_id"]
        branch_id = request.path_params["branch_id"]
        tag_id = request.path_params["tag_id"]

        if request.method == "PUT":
            tag_data = await request.json()
            model.put_tag(repo_id, branch_id, tag_id, tag_data)
            return _responses.Response("OK\n")

        if request.method == "DELETE":
            model.delete_tag(repo_id, branch_id, tag_id)
            return _responses.Response("OK\n")

        request.object = model.repos[repo_id].branches[branch_id].tags[tag_id]

        if request.method == "HEAD":
            return self.process_head(request)

class _ArtifactHandler(_ModelObjectHandler):
    async def process(self, request):
        model = request.app.model
        repo_id = request.path_params["repo_id"]
        branch_id = request.path_params["branch_id"]
        tag_id = request.path_params["tag_id"]
        artifact_id = request.path_params["artifact_id"]

        if request.method == "PUT":
            artifact_data = await request.json()
            model.put_artifact(repo_id, branch_id, tag_id, artifact_id, artifact_data)
            return _responses.Response("OK\n")

        if request.method == "DELETE":
            model.delete_artifact(repo_id, branch_id, tag_id, artifact_id)
            return _responses.Response("OK\n")

        request.object = model.repos[repo_id].branches[branch_id].tags[tag_id].artifacts[artifact_id]

        if request.method == "HEAD":
            return self.process_head(request)
