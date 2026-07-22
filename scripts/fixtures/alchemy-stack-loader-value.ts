class StackLoaderValue {
  // oxlint-disable-next-line typescript/parameter-properties -- This regression fixture must exercise non-erasable TypeScript syntax.
  constructor(readonly loaded: boolean) {}

  requireLoaded(): true {
    if (this.loaded !== true) {
      throw new Error("stack loader did not preserve transformed semantics");
    }

    return true;
  }
}

/** Value imported through a transformed NodeNext source module by the fixture. */
export const fixtureLoaded = new StackLoaderValue(true).requireLoaded();
