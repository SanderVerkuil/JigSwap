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
import type * as catalog_adapters_catalogIdGenerator from "../catalog/adapters/catalogIdGenerator.js";
import type * as catalog_adapters_convexCatalogCategoryRepository from "../catalog/adapters/convexCatalogCategoryRepository.js";
import type * as catalog_adapters_convexPuzzleDefinitionRepository from "../catalog/adapters/convexPuzzleDefinitionRepository.js";
import type * as catalog_adapters_eventPublisher from "../catalog/adapters/eventPublisher.js";
import type * as catalog_adapters_mapper from "../catalog/adapters/mapper.js";
import type * as catalog_adapters_systemClock from "../catalog/adapters/systemClock.js";
import type * as catalog_approvePuzzleDefinition from "../catalog/approvePuzzleDefinition.js";
import type * as catalog_createCatalogCategory from "../catalog/createCatalogCategory.js";
import type * as catalog_errors from "../catalog/errors.js";
import type * as catalog_listPendingPuzzleDefinitions from "../catalog/listPendingPuzzleDefinitions.js";
import type * as catalog_rejectPuzzleDefinition from "../catalog/rejectPuzzleDefinition.js";
import type * as catalog_reorderCatalogCategories from "../catalog/reorderCatalogCategories.js";
import type * as catalog_runDefinitionAction from "../catalog/runDefinitionAction.js";
import type * as catalog_setCatalogCategoryActive from "../catalog/setCatalogCategoryActive.js";
import type * as catalog_submitPuzzleDefinition from "../catalog/submitPuzzleDefinition.js";
import type * as catalog_updateCatalogCategory from "../catalog/updateCatalogCategory.js";
import type * as catalog_updatePuzzleDefinition from "../catalog/updatePuzzleDefinition.js";
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
import type * as library_acquireCopy from "../library/acquireCopy.js";
import type * as library_adapters_convexCatalogSnapshotProvider from "../library/adapters/convexCatalogSnapshotProvider.js";
import type * as library_adapters_convexCollectionRepository from "../library/adapters/convexCollectionRepository.js";
import type * as library_adapters_convexCopyRepository from "../library/adapters/convexCopyRepository.js";
import type * as library_adapters_convexCopyReservationPort from "../library/adapters/convexCopyReservationPort.js";
import type * as library_adapters_convexPersonalCategoryRepository from "../library/adapters/convexPersonalCategoryRepository.js";
import type * as library_adapters_copyMapper from "../library/adapters/copyMapper.js";
import type * as library_adapters_eventPublisher from "../library/adapters/eventPublisher.js";
import type * as library_adapters_idGenerators from "../library/adapters/idGenerators.js";
import type * as library_adapters_systemClock from "../library/adapters/systemClock.js";
import type * as library_adapters_visibilityPolicy from "../library/adapters/visibilityPolicy.js";
import type * as library_addCopyImage from "../library/addCopyImage.js";
import type * as library_addCopyToCollection from "../library/addCopyToCollection.js";
import type * as library_backfill from "../library/backfill.js";
import type * as library_changeCopyCondition from "../library/changeCopyCondition.js";
import type * as library_createCollection from "../library/createCollection.js";
import type * as library_createPersonalCategory from "../library/createPersonalCategory.js";
import type * as library_deleteCollection from "../library/deleteCollection.js";
import type * as library_errors from "../library/errors.js";
import type * as library_removeCopyFromCollection from "../library/removeCopyFromCollection.js";
import type * as library_updateCopySharing from "../library/updateCopySharing.js";
import type * as puzzles from "../puzzles.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminCategories: typeof adminCategories;
  "catalog/adapters/catalogIdGenerator": typeof catalog_adapters_catalogIdGenerator;
  "catalog/adapters/convexCatalogCategoryRepository": typeof catalog_adapters_convexCatalogCategoryRepository;
  "catalog/adapters/convexPuzzleDefinitionRepository": typeof catalog_adapters_convexPuzzleDefinitionRepository;
  "catalog/adapters/eventPublisher": typeof catalog_adapters_eventPublisher;
  "catalog/adapters/mapper": typeof catalog_adapters_mapper;
  "catalog/adapters/systemClock": typeof catalog_adapters_systemClock;
  "catalog/approvePuzzleDefinition": typeof catalog_approvePuzzleDefinition;
  "catalog/createCatalogCategory": typeof catalog_createCatalogCategory;
  "catalog/errors": typeof catalog_errors;
  "catalog/listPendingPuzzleDefinitions": typeof catalog_listPendingPuzzleDefinitions;
  "catalog/rejectPuzzleDefinition": typeof catalog_rejectPuzzleDefinition;
  "catalog/reorderCatalogCategories": typeof catalog_reorderCatalogCategories;
  "catalog/runDefinitionAction": typeof catalog_runDefinitionAction;
  "catalog/setCatalogCategoryActive": typeof catalog_setCatalogCategoryActive;
  "catalog/submitPuzzleDefinition": typeof catalog_submitPuzzleDefinition;
  "catalog/updateCatalogCategory": typeof catalog_updateCatalogCategory;
  "catalog/updatePuzzleDefinition": typeof catalog_updatePuzzleDefinition;
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
  "library/acquireCopy": typeof library_acquireCopy;
  "library/adapters/convexCatalogSnapshotProvider": typeof library_adapters_convexCatalogSnapshotProvider;
  "library/adapters/convexCollectionRepository": typeof library_adapters_convexCollectionRepository;
  "library/adapters/convexCopyRepository": typeof library_adapters_convexCopyRepository;
  "library/adapters/convexCopyReservationPort": typeof library_adapters_convexCopyReservationPort;
  "library/adapters/convexPersonalCategoryRepository": typeof library_adapters_convexPersonalCategoryRepository;
  "library/adapters/copyMapper": typeof library_adapters_copyMapper;
  "library/adapters/eventPublisher": typeof library_adapters_eventPublisher;
  "library/adapters/idGenerators": typeof library_adapters_idGenerators;
  "library/adapters/systemClock": typeof library_adapters_systemClock;
  "library/adapters/visibilityPolicy": typeof library_adapters_visibilityPolicy;
  "library/addCopyImage": typeof library_addCopyImage;
  "library/addCopyToCollection": typeof library_addCopyToCollection;
  "library/backfill": typeof library_backfill;
  "library/changeCopyCondition": typeof library_changeCopyCondition;
  "library/createCollection": typeof library_createCollection;
  "library/createPersonalCategory": typeof library_createPersonalCategory;
  "library/deleteCollection": typeof library_deleteCollection;
  "library/errors": typeof library_errors;
  "library/removeCopyFromCollection": typeof library_removeCopyFromCollection;
  "library/updateCopySharing": typeof library_updateCopySharing;
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
