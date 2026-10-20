import { loadSharedHooks } from "./test-production-loader.mjs";

const {
  APP_API_MESSAGE_TYPE,
  APP_API_PROTOCOL_VERSION,
  APP_API_ERROR_CODES,
  validateAppApiRequest,
  appApiResponse,
  appApiErrorResponse,
  appApiError
} = loadSharedHooks();

const request = {
  type: APP_API_MESSAGE_TYPE,
  protocolVersion: APP_API_PROTOCOL_VERSION,
  requestId: "request-1",
  method: "courses.list",
  params: { active: true }
};
if (validateAppApiRequest(request) !== null) throw new Error("Valid API request was rejected");

const success = appApiResponse(request, { courses: [] }, { databaseRevision: 4, generatedAt: "2026-09-27T12:00:00.000Z" });
if (!success.ok || success.requestId !== "request-1" || success.meta.databaseRevision !== 4) throw new Error("Success envelope is invalid");

const unknown = validateAppApiRequest({ ...request, method: "unknown.method" });
if (unknown?.code !== APP_API_ERROR_CODES.METHOD_NOT_FOUND) throw new Error("Unknown method was not classified");
const badParams = validateAppApiRequest({ ...request, params: [] });
if (badParams?.code !== APP_API_ERROR_CODES.INVALID_PARAMS) throw new Error("Array params were not rejected");
const badVersion = validateAppApiRequest({ ...request, protocolVersion: "99" });
if (badVersion?.code !== APP_API_ERROR_CODES.INVALID_REQUEST) throw new Error("Protocol mismatch was not rejected");

const failure = appApiErrorResponse(request, appApiError(APP_API_ERROR_CODES.NOT_FOUND, "Missing"));
if (failure.ok || failure.error.code !== APP_API_ERROR_CODES.NOT_FOUND) throw new Error("Error envelope is invalid");

console.log("Application API contract validates requests and stable response envelopes.");
