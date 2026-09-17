// @flow
import kebabCase from "lodash-es/kebabCase.js";

const input: string = process.argv.slice(2).join(" ") || "Hello Native JavaScript";
console.log(kebabCase(input));
