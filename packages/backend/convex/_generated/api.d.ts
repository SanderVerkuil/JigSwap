/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminCategories from "../adminCategories.js";
import type * as collections from "../collections.js";
import type * as exchange_accept from "../exchange/accept.js";
import type * as exchange_adapters_convexCopyPort from "../exchange/adapters/convexCopyPort.js";
import type * as exchange_adapters_convexExchangeRepository from "../exchange/adapters/convexExchangeRepository.js";
import type * as exchange_adapters_inProcessEventPublisher from "../exchange/adapters/inProcessEventPublisher.js";
import type * as exchange_adapters_mapper from "../exchange/adapters/mapper.js";
import type * as exchange_adapters_systemClock from "../exchange/adapters/systemClock.js";
import type * as exchange_adapters_uuidExchangeId from "../exchange/adapters/uuidExchangeId.js";
import type * as exchange_backfill from "../exchange/backfill.js";
import type * as exchange_cancel from "../exchange/cancel.js";
import type * as exchange_confirmCompletion from "../exchange/confirmCompletion.js";
import type * as exchange_decline from "../exchange/decline.js";
import type * as exchange_errors from "../exchange/errors.js";
import type * as exchange_propose from "../exchange/propose.js";
import type * as exchange_raiseDispute from "../exchange/raiseDispute.js";
import type * as exchange_runAction from "../exchange/runAction.js";
import type * as exchanges from "../exchanges.js";
import type * as http from "../http.js";
import type * as identity_requireMember from "../identity/requireMember.js";
import type * as puzzles from "../puzzles.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminCategories: typeof adminCategories;
  collections: typeof collections;
  "exchange/accept": typeof exchange_accept;
  "exchange/adapters/convexCopyPort": typeof exchange_adapters_convexCopyPort;
  "exchange/adapters/convexExchangeRepository": typeof exchange_adapters_convexExchangeRepository;
  "exchange/adapters/inProcessEventPublisher": typeof exchange_adapters_inProcessEventPublisher;
  "exchange/adapters/mapper": typeof exchange_adapters_mapper;
  "exchange/adapters/systemClock": typeof exchange_adapters_systemClock;
  "exchange/adapters/uuidExchangeId": typeof exchange_adapters_uuidExchangeId;
  "exchange/backfill": typeof exchange_backfill;
  "exchange/cancel": typeof exchange_cancel;
  "exchange/confirmCompletion": typeof exchange_confirmCompletion;
  "exchange/decline": typeof exchange_decline;
  "exchange/errors": typeof exchange_errors;
  "exchange/propose": typeof exchange_propose;
  "exchange/raiseDispute": typeof exchange_raiseDispute;
  "exchange/runAction": typeof exchange_runAction;
  exchanges: typeof exchanges;
  http: typeof http;
  "identity/requireMember": typeof identity_requireMember;
  puzzles: typeof puzzles;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
