import { describe, expect, it } from "vitest";
import { LibraryError } from "./errors";

describe("LibraryError factories", () => {
  it("notOwner interpolates the action", () => {
    const e = LibraryError.notOwner("update this collection");
    expect(e.code).toBe("NotOwner");
    expect(e.name).toBe("LibraryError");
    expect(e.message).toBe("Acting member may not update this collection");
  });

  it("invalidCondition interpolates the unknown value", () => {
    const e = LibraryError.invalidCondition("mint");
    expect(e.code).toBe("InvalidCondition");
    expect(e.message).toBe("Unknown condition: mint");
  });

  it("invalidPrice interpolates the detail", () => {
    const e = LibraryError.invalidPrice("amount must be positive");
    expect(e.code).toBe("InvalidPrice");
    expect(e.message).toBe("Invalid price: amount must be positive");
  });

  it("invalidAcquisitionDate", () => {
    const e = LibraryError.invalidAcquisitionDate();
    expect(e.code).toBe("InvalidAcquisitionDate");
    expect(e.message).toBe("Not a date a copy can have been acquired on");
  });

  it("duplicateCollectionName interpolates the name", () => {
    const e = LibraryError.duplicateCollectionName("Favorites");
    expect(e.code).toBe("DuplicateCollectionName");
    expect(e.message).toBe('A collection named "Favorites" already exists');
  });

  it("cannotDeleteDefaultCollection", () => {
    const e = LibraryError.cannotDeleteDefaultCollection();
    expect(e.code).toBe("CannotDeleteDefaultCollection");
    expect(e.message).toBe("A default collection cannot be deleted");
  });

  it("copyNotInCollection", () => {
    const e = LibraryError.copyNotInCollection();
    expect(e.code).toBe("CopyNotInCollection");
    expect(e.message).toBe("The copy is not a member of this collection");
  });

  it("wrongMemberType carries the supplied detail as the message", () => {
    const e = LibraryError.wrongMemberType(
      "A wishlist holds desired definitions, not copies",
    );
    expect(e.code).toBe("WrongMemberType");
    expect(e.message).toBe("A wishlist holds desired definitions, not copies");
  });

  it("ownershipChanged", () => {
    const e = LibraryError.ownershipChanged();
    expect(e.code).toBe("OwnershipChanged");
    expect(e.message).toBe(
      "The copy no longer belongs to the member the exchange was made with",
    );
  });

  it("alreadyLentOut", () => {
    const e = LibraryError.alreadyLentOut();
    expect(e.code).toBe("AlreadyLentOut");
    expect(e.message).toBe("The copy is already out on loan");
  });

  it("tooManyImages names the cap", () => {
    const e = LibraryError.tooManyImages(20);
    expect(e.code).toBe("TooManyImages");
    expect(e.message).toBe("A copy can have at most 20 photos");
  });

  it("imageTextTooLong names the field and its limit", () => {
    const e = LibraryError.imageTextTooLong("title", 200);
    expect(e.code).toBe("ImageTextTooLong");
    expect(e.message).toBe("A photo title can be at most 200 characters");
  });
});
