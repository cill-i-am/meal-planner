import { Kind, OperationTypeNode, parse } from "graphql";

declare const ReadOnlyGraphQlDocumentTypeId: unique symbol;

/** A source-controlled GraphQL document proven to contain one named query. */
export type ReadOnlyGraphQlDocument = string & {
  readonly [ReadOnlyGraphQlDocumentTypeId]: true;
};

/** A named, source-controlled GraphQL query safe for the Tesco read façade. */
export interface ReadOnlyGraphQlOperation {
  readonly document: ReadOnlyGraphQlDocument;
  readonly operationName: string;
}

/** Stable reasons why a source-controlled GraphQL definition is invalid. */
export type InvalidReadOnlyGraphQlOperationReason =
  | "AnonymousOperation"
  | "InvalidDocument"
  | "MismatchedOperationName"
  | "MultipleOperations"
  | "MutationOperation"
  | "NoOperation"
  | "SubscriptionOperation"
  | "UnexpectedDefinition";

/** A safe developer defect raised for an invalid source-controlled query. */
export class InvalidReadOnlyGraphQlOperationError extends Error {
  readonly _tag = "InvalidReadOnlyGraphQlOperation";
  readonly operationName: string;
  readonly reason: InvalidReadOnlyGraphQlOperationReason;

  constructor(
    reason: InvalidReadOnlyGraphQlOperationReason,
    operationName: string
  ) {
    super("Invalid read-only GraphQL operation definition");
    this.name = "InvalidReadOnlyGraphQlOperationError";
    this.operationName = operationName;
    this.reason = reason;
  }
}

const invalid = (
  reason: InvalidReadOnlyGraphQlOperationReason,
  operationName: string
): never => {
  throw new InvalidReadOnlyGraphQlOperationError(reason, operationName);
};

/** Proves that a source-controlled document contains exactly one named query. */
export const defineReadOnlyGraphQlOperation = (input: {
  readonly document: string;
  readonly operationName: string;
}) => {
  let parsed: ReturnType<typeof parse>;

  try {
    parsed = parse(input.document);
  } catch {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "InvalidDocument",
      input.operationName
    );
    return checkedResult;
  }

  if (
    parsed.definitions.some(
      (definition) =>
        definition.kind !== Kind.OPERATION_DEFINITION &&
        definition.kind !== Kind.FRAGMENT_DEFINITION
    )
  ) {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "UnexpectedDefinition",
      input.operationName
    );
    return checkedResult;
  }

  const operations = parsed.definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION
  );

  if (operations.length === 0) {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "NoOperation",
      input.operationName
    );
    return checkedResult;
  }
  if (operations.length > 1) {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "MultipleOperations",
      input.operationName
    );
    return checkedResult;
  }

  const [operation] = operations;
  if (operation === undefined) {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "NoOperation",
      input.operationName
    );
    return checkedResult;
  }
  if (operation.operation === OperationTypeNode.MUTATION) {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "MutationOperation",
      input.operationName
    );
    return checkedResult;
  }
  if (operation.operation === OperationTypeNode.SUBSCRIPTION) {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "SubscriptionOperation",
      input.operationName
    );
    return checkedResult;
  }
  if (operation.name === undefined) {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "AnonymousOperation",
      input.operationName
    );
    return checkedResult;
  }
  if (operation.name.value !== input.operationName) {
    const checkedResult: ReadOnlyGraphQlOperation = invalid(
      "MismatchedOperationName",
      input.operationName
    );
    return checkedResult;
  }

  {
    const checkedResult: ReadOnlyGraphQlOperation = {
      document: input.document as ReadOnlyGraphQlDocument,
      operationName: input.operationName,
    };
    return checkedResult;
  }
};
