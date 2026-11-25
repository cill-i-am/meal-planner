import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type Parameter = ESTree.ParamPattern;
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

const parameterAnnotation = (parameter: Parameter) => {
  if (parameter.type === "TSParameterProperty") {
    const checkedResult: ESTree.TSTypeAnnotation | null | undefined =
      parameterAnnotation(parameter.parameter);
    return checkedResult;
  }
  if (parameter.type === "RestElement") {
    const checkedResult: ESTree.TSTypeAnnotation | null | undefined =
      parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
    return checkedResult;
  }
  if (parameter.type === "AssignmentPattern") {
    const checkedResult: ESTree.TSTypeAnnotation | null | undefined =
      parameter.typeAnnotation ?? parameter.left.typeAnnotation;
    return checkedResult;
  }
  {
    const checkedResult: ESTree.TSTypeAnnotation | null | undefined =
      parameter.typeAnnotation;
    return checkedResult;
  }
};

const parameterName = (parameter: Parameter, sourceText: string) => {
  if (parameter.type === "TSParameterProperty") {
    const checkedResult: string = parameterName(
      parameter.parameter,
      sourceText
    );
    return checkedResult;
  }
  if (parameter.type === "AssignmentPattern") {
    const checkedResult: string = parameterName(parameter.left, sourceText);
    return checkedResult;
  }
  if (parameter.type === "RestElement") {
    const checkedResult: string = parameterName(parameter.argument, sourceText);
    return checkedResult;
  }
  {
    const checkedResult: string =
      parameter.type === "Identifier"
        ? parameter.name
        : sourceText.replace(/\s*:\s*unknown\s*$/u, "");
    return checkedResult;
  }
};

/** Disallow unknown inputs except explicitly named error-cause enrichment. */
export const noUnknownParametersRule = defineRule({
  createOnce(context) {
    const checkParameters = (node: ParameterOwner) => {
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter);
        if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") {
          continue;
        }
        const name = parameterName(
          parameter,
          context.sourceCode.getText(parameter)
        );
        if (name === "cause") {
          continue;
        }
        context.report({
          data: { parameter: name },
          messageId: "unknownParameter",
          node: annotation.typeAnnotation,
        });
      }
    };

    return {
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
  meta: {
    docs: {
      description:
        "Disallow explicitly unknown function parameters except `cause`; decode unknown input at its I/O boundary instead.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
    },
    type: "problem",
  },
});
