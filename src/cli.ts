#!/usr/bin/env node

import { AptosTsgen } from "./aptosTsgen";

const tsgen = (args: string[]) => {
  const generator = new AptosTsgen([], args[0], args.slice(1));
  generator.generate();
}

const main = () => {
  const remainingArgs = process.argv.slice(2);
  if(remainingArgs.length < 2) {
    console.log("Usage: aptos-tsgen OutputDirName JSON_INCLUDE_DIR1 JSON_INCLUDE_DIR2 ...");
    process.exit();
  }
  tsgen(remainingArgs);
}
main();