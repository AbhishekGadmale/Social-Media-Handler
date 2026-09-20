"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var execution_metadata_1 = require("./packages/shared/src/publishing/execution-metadata");
// Let's just create a manual object and parse it!
var obj = {
    version: 1,
    operationId: "81e4b868-b7eb-44c3-a3d2-23c28059ea9d",
    provider: "INSTAGRAM",
    phase: "PUBLISH_REQUESTED",
    containerId: "c",
    containerCreatedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    nextCheckAt: new Date().toISOString(),
    publishRequestedAt: new Date().toISOString(),
};
var res = (0, execution_metadata_1.safeParseExecutionMetadata)(obj);
if (!res.success) {
    console.log(res.error.errors);
}
else {
    console.log("SUCCESS");
}
