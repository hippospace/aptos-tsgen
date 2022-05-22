import { HexString } from "aptos";
import fs from "fs";
import path from "path";
import { AtomicTypeTag, parseTypeTagOrThrow, StructTag, TypeParamIdx, TypeTag, VectorTag } from "./typeTag";

export type TypeTagString = string;

export type JsonStructFieldType = {
  name: string;
  type: TypeTagString;
}

export type JsonNamedConstantType = {
  name: string;
  type: TypeTagString;
  value: string;
}

export type JsonAbilityType = "key" | "store" | "copy" | "drop";

export type JsonTypeParamType = {
  name: string;
  abilities: JsonAbilityType[];
  is_phantom: boolean;
}

export type JsonStructType = {
  name: string;
  abilities: JsonAbilityType[];
  type_params: JsonTypeParamType[];
  fields: JsonStructFieldType[];
}

export type JsonFuncParamType = {
  name: string;
  type: TypeTagString;
}

export type JsonFuncType = {
  name: string;
  type_params: JsonTypeParamType[];
  params: JsonFuncParamType[];
}

export type JsonModuleType = {
  address: string;
  module: string;
  constants: JsonNamedConstantType[];
  structs: JsonStructType[];
  script_functions: JsonFuncType[];
}

/*
What we generate for each JsonModuleType:
- export const moduleAddress: string
- export const moduleName: string
- one for each named constant:
  export const CONST_NAME: type = value;

One for each struct

One for each script function

*/

enum IMPORT {
  HEXSTRING = "HexString",
  BIGINT = "bigInt",
  TYPE_PARAM_DECL_TYPE = "TypeParamDeclType",
  FIELD_DECL_TYPE = "FieldDeclType",
  PARSE_TYPE_TAG_OR_THROW = "parseTypeTagOrThrow",
  TYPETAG = "TypeTag",
  GET_TYPETAG_FULLNAME = "getTyptagFullName",
  APTOS_PARSER_REPO = "AptosParserRepo",
  PARSE_STRUCT_PROTO = "parseStructProto",
  APTOS_CLIENT = "AptosClient",
  APTOS_ACCOUNT = "AptosAccount",
  USER_TRANSACTION = "UserTransaction",
  SEND_AND_WAIT = "sendAndWait",
}

const IMPORT_MAP: Record<IMPORT, string> = {
  [IMPORT.HEXSTRING] : 'import { HexString } from "aptos";',
  [IMPORT.BIGINT] : 'import bigInt from "big-integer";',
  [IMPORT.TYPE_PARAM_DECL_TYPE] : 'import { TypeParamDeclType } from "@manahippo/aptos-tsgen";',
  [IMPORT.FIELD_DECL_TYPE] : 'import { FieldDeclType } from "@manahippo/aptos-tsgen";',
  [IMPORT.PARSE_TYPE_TAG_OR_THROW] : 'import { parseTypeTagOrThrow } from "@manahippo/aptos-tsgen";',
  [IMPORT.TYPETAG] : 'import { TypeTag } from "@manahippo/aptos-tsgen";',
  [IMPORT.GET_TYPETAG_FULLNAME] : 'import { getTypeTagFullname } from "@manahippo/aptos-tsgen";',
  [IMPORT.APTOS_PARSER_REPO] : 'import { AptosParserRepo } from "@manahippo/aptos-tsgen";',
  [IMPORT.PARSE_STRUCT_PROTO] : 'import { parseStructProto } from "@manahippo/aptos-tsgen";',
  [IMPORT.APTOS_CLIENT] : 'import { AptosClient } from "aptos";',
  [IMPORT.APTOS_ACCOUNT] : 'import { AptosAccount } from "aptos";',
  [IMPORT.USER_TRANSACTION] : 'import { UserTransaction } from "aptos";',
  [IMPORT.SEND_AND_WAIT] : 'import { sendAndWait } from "@manahippo/aptos-tsgen";',
}

/*
A more systematic treatment for type mapping

  Move type           TypeScript type         API output type

  bool                boolean                 boolean
  u8                  number                  number
  u64                 BigInteger              string: "${BigInteger.toString()}"
  u128                BigInteger              string: "${BigInteger.toString()}"
  address             HexString               string: "${HexString.hex()}"

  vector<u8>          number[]                string: "${HexString.fromUint8Array(number[]).hex()}"
  0x1::ASCII:String   string                  string

*/

export class AptosTsgen {
  lines: string[];
  imports: Set<IMPORT>;
  importedAddresses: Set<string>;
  importedModulesUnderSameAddress: Set<string>;
  constructor(
    public moduleDescriptors: JsonModuleType[],
    public outputDir: string,
    public jsonIncludeDirs: string[]
  ) { 
    if(this.outputDir.endsWith('/')) {
      this.outputDir = this.outputDir.substr(0, this.outputDir.length - 1);
    }
    this.lines = [];
    this.imports = new Set();
    this.importedAddresses = new Set();
    this.importedModulesUnderSameAddress = new Set();
  }

  generate() {
    /*
    Generates:
    - outputDir/address/Module.ts: a set of module-specific .ts files in outputDir
    - outputDir/repo.ts: a single function that returns ParserRepo with all parsers added
    */
    for(const jsonDir of this.jsonIncludeDirs) {
      /*
      1. Load all the JSONs into JsonModuleType[]
      2. Generate one outputDir/address/Module.ts for each JsonModuleType
      */
      const filenames = fs.readdirSync(jsonDir, 'utf-8').filter(fn=>fn.endsWith('.json'));
      for(const filename of filenames) {
        const fullname = path.join(jsonDir, filename);
        const fileContent = fs.readFileSync(fullname, 'utf-8');
        // step 1
        const parsedJson = JSON.parse(fileContent);
        // check if it has the basic things:
        const hasAddress = 'address' in parsedJson;
        const hasModule = 'module' in parsedJson;
        const hasConstants = 'constants' in parsedJson;
        const hasStructs = 'structs' in parsedJson;
        const hasScriptFuncs = 'script_functions' in parsedJson;
        if(!(hasAddress && hasModule && hasConstants && hasStructs && hasScriptFuncs)) {
          throw new Error(`File ${filename} is not a valid tsgen input json as it is missing some key fields.`);
        }
        // now we trust it is valid 
        const module = parsedJson as JsonModuleType;
        this.moduleDescriptors.push(module);
        // step 2
        this.generateModule(module);
      }
    }

    // oututDir/repo.ts
    this.generateRepo();

    // outputDir/address/index.ts
    this.generateIndexForAddresses();

  }

  generateRepo() {
    this.lines = [];
    // generate imports
    this.emitln('import { AptosParserRepo } from "@manahippo/aptos-tsgen";');
    for(const module of this.moduleDescriptors) {
      this.emitln(`import * as X${module.address}_${module.module} from "./X${module.address}/${module.module}";`);
    }
    // generate big getParser() functions
    this.emitln("export function getParserRepo(): AptosParserRepo {");
    this.emitln("  const repo = new AptosParserRepo();");
    for(const module of this.moduleDescriptors) {
      this.emitln(`  X${module.address}_${module.module}.loadParsers(repo);`);
    }
    this.emitln("  repo.addDefaultParsers();");
    this.emitln("  return repo;");
    this.emitln("}");
    // write to file
    const fileOutput = this.lines.join('\n');
    const outputDirname = this.outputDir;
    const outputFilename = path.join(outputDirname, "repo.ts");
    if(!fs.existsSync(outputDirname)) {
      fs.mkdirSync(outputDirname);
    }
    fs.writeFileSync(outputFilename, fileOutput);
    this.lines = [];
  }

  generateIndexForAddresses() {
    const addresses: Set<string> = new Set(this.moduleDescriptors.map(m=>m.address));;
    for(const address of addresses) {
      //
      this.lines = [];
      const mods = this.moduleDescriptors.filter(m=>m.address === address);
      for(const mod of mods) {
        this.emitln(`export * as ${mod.module} from "./${mod.module}";`);
      }
      //
      const fileOutput = this.lines.join('\n');
      const outputDirname = path.join(this.outputDir, `X${address}`);
      const outputFilename = path.join(outputDirname, "index.ts");
      if(!fs.existsSync(outputDirname)) {
        fs.mkdirSync(outputDirname);
      }
      fs.writeFileSync(outputFilename, fileOutput);
      this.lines = [];
    }
  }

  generateModule(module: JsonModuleType) {
    console.log(`Handling ${module.address}::${module.module}`);
    this.lines = [];
    this.imports.clear();
    this.importedAddresses.clear();
    this.importedModulesUnderSameAddress.clear();
    // Add imports first, emit later
    this.imports.add(IMPORT.HEXSTRING)

    // moduleAddress
    this.emitln(`export const moduleAddress = new HexString("${module.address}");`);
    // moduleName
    this.emitln(`export const moduleName = "${module.module}";`);
    this.emitln("");

    // constants
    for(const constant of module.constants) {
      this.generateConstant(constant);
    }
    this.emitln("");
    // structs
    for(const struct of module.structs) {
      this.generateStruct(struct, module);
      this.emitln("");
    }
    // script functions
    for(const func of module.script_functions) {
      this.generateScriptFunction(func, module);
      this.emitln("");
    }

    // repo loader
    this.imports.add(IMPORT.APTOS_PARSER_REPO);
    this.emitln("export function loadParsers(repo: AptosParserRepo) {")
    for(const struct of module.structs) {
      // TODO: exlude String and FixedPoint32
      const paramlessName = `${module.address}::${module.module}::${struct.name}`;
      this.emitln(`  repo.addParser("${paramlessName}", ${struct.name}.${struct.name}Parser);`);
    }
    this.emitln("}")

    // collect imports
    const importLines:string[] = [];
    this.imports.forEach(importTag=> {
      importLines.push(IMPORT_MAP[importTag]);
    });
    this.importedAddresses.forEach(addr=>{
      importLines.push(`import * as ${addr} from "../${addr}";`);
    });
    this.importedModulesUnderSameAddress.forEach(mod=>{
      importLines.push(`import * as ${mod} from "./${mod}";`);
    });

    // write to file
    const fileOutput = importLines.join('\n') + "\n\n" + this.lines.join('\n');
    const outputDirname = path.join(this.outputDir, `X${module.address}`);
    const outputFilename = path.join(outputDirname, `${module.module}.ts`);
    if(!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir);
    }
    if(!fs.existsSync(outputDirname)) {
      fs.mkdirSync(outputDirname);
    }
    fs.writeFileSync(outputFilename, fileOutput);

    // cleaer lines
    this.lines = [];
    this.imports.clear();
    this.importedAddresses.clear();
    this.importedModulesUnderSameAddress.clear();
  }

  generateConstant(constant: JsonNamedConstantType) {
    const typeTag = constant.type as AtomicTypeTag;
    let tsTypeName, tsInitValue;
    if (typeTag === AtomicTypeTag.Bool) {
      tsTypeName = "boolean";
      tsInitValue = constant.value;
    }
    else if (typeTag === AtomicTypeTag.U8) {
      tsTypeName = "number";
      tsInitValue = constant.value;
    }
    else if (typeTag === AtomicTypeTag.U64 || typeTag === AtomicTypeTag.U128) {
      tsTypeName = "bigInt.BigInteger";
      tsInitValue = `bigInt("${constant.value}")`;
      this.imports.add(IMPORT.BIGINT)
    }
    else {
      throw new Error(`Unsupported constant type: ${constant.type}`);
    }
    this.emitln(`export const ${constant.name}: ${tsTypeName} = ${tsInitValue};`);
  }

  typeTagToTsType(typeTag: TypeTag, module: JsonModuleType, allowStruct: boolean): string {
    /*
    Used by 2 locations:
    - generateStruct: for declaring the TS type of each field
    - generateScriptFunction: for declaring the TS type of each function parameter
    */
    let tsType:string;
    if (typeTag instanceof StructTag) {
      /*
      A few special cases:
      - 0x1::ASCII::String -> string
      */
      if (typeTag.module === 'ASCII' && typeTag.address.toShortString() === '0x1') {
        tsType = 'string';
      }
      else {
        /*
        3 cases:
        - struct from same address::module
        - struct from same address, but different module
        - struct from different address altogether
        */
        if(!allowStruct) {
          throw new Error(`StructTag not allowed in: ${typeTag}`);
        }
        const sameAddress = typeTag.address.toShortString() === new HexString(module.address).toShortString();
        const isInternal = sameAddress && typeTag.module === module.module;
        if (isInternal) {
          tsType = typeTag.name;
        }
        else if(sameAddress) {
          tsType = `${typeTag.module}.${typeTag.name}`;
          this.importedModulesUnderSameAddress.add(`${typeTag.module}`);
        }
        else {
          tsType = `X${typeTag.address}.${typeTag.module}.${typeTag.name}`;
          this.importedAddresses.add(`X${typeTag.address}`);
        }
      }
    }
    else if (typeTag instanceof VectorTag) {
      const innerTsType = this.typeTagToTsType(typeTag.elementType, module, allowStruct);
      tsType = `${innerTsType}[]`;
    }
    else if (typeTag instanceof TypeParamIdx) {
      tsType = 'any';
    }
    else {
      if(typeTag === AtomicTypeTag.U8) {
        tsType = "number";
      }
      else if(typeTag === AtomicTypeTag.U64 || typeTag === AtomicTypeTag.U128) {
        this.imports.add(IMPORT.BIGINT);
        tsType = "bigInt.BigInteger";
      }
      else if(typeTag === AtomicTypeTag.Bool) {
        tsType = "boolean";
      }
      else if(typeTag === AtomicTypeTag.Address) {
        this.imports.add(IMPORT.HEXSTRING);
        tsType = "HexString";
      }
      else {
        throw new Error(`Unsupported type: ${typeTag}`);
      }
    }

    return tsType;
  }

  generateStruct(struct: JsonStructType, module: JsonModuleType) {
    this.emitln(`export class ${struct.name} {`);
    this.emitln("  static moduleAddress = moduleAddress;");
    this.emitln("  static moduleName = moduleName;");
    this.emitln(`  static structName: string = "${struct.name}";`);

    // type parameters
    this.imports.add(IMPORT.TYPE_PARAM_DECL_TYPE);
    this.emitln("  static typeParameters: TypeParamDeclType[] = [");
    struct.type_params.forEach((typeParam, idx) => {
      const lastComma = (idx + 1) === struct.type_params.length ? "" : ",";
      this.emitln(`    {name: "${typeParam.name}", isPhantom: ${typeParam.is_phantom}}${lastComma}`);
    });
    this.emitln("  ];");

    // fields
    this.imports.add(IMPORT.FIELD_DECL_TYPE);
    this.emitln("  static fields: FieldDeclType[] = [");
    struct.fields.forEach((field, idx) => {
      const lastComma = (idx + 1) === struct.fields.length ? "" : ",";
      this.imports.add(IMPORT.PARSE_TYPE_TAG_OR_THROW);
      this.emitln(`    {name: "${field.name}", typeTag: parseTypeTagOrThrow("${field.type}")}${lastComma}`);
    });
    this.emitln("  ];");
    this.emitln("");

    // the actual member properties of the class:
    const fieldNameToTsType: Record<string, string> = {};
    struct.fields.forEach(field => {
      // question: how to map the tsType here?
      const typeTag = parseTypeTagOrThrow(field.type);
      const tsType = this.typeTagToTsType(typeTag, module, true);
      fieldNameToTsType[field.name] = tsType;
      this.emitln(`  ${field.name}: ${tsType};`)
    });
    this.emitln("");

    // now, the constructor
    this.emitln("  constructor(proto: any, public typeTag: TypeTag) {")
    // one line for each field
    struct.fields.forEach(field => {
      const tsType = fieldNameToTsType[field.name];
      this.emitln(`    this.${field.name} = proto['${field.name}'] as ${tsType};`);
    });
    this.emitln("  }")
    this.emitln("");

    // now, the static parser function
    this.imports.add(IMPORT.TYPETAG);
    this.imports.add(IMPORT.APTOS_PARSER_REPO);
    this.imports.add(IMPORT.PARSE_STRUCT_PROTO);
    this.emitln(`  static ${struct.name}Parser(data:any, typeTag: TypeTag, repo: AptosParserRepo) : ${struct.name} {`);
    this.emitln(`    const proto = parseStructProto(data, typeTag, repo, ${struct.name});`);
    this.emitln(`    return new ${struct.name}(proto, typeTag);`);
    this.emitln(`  }`);
    this.emitln("");

    // loadResource()
    if (struct.abilities.includes('key')) {
      this.imports.add(IMPORT.APTOS_CLIENT);
      this.imports.add(IMPORT.APTOS_ACCOUNT);
      this.imports.add(IMPORT.HEXSTRING);
      this.imports.add(IMPORT.TYPETAG);
      this.imports.add(IMPORT.APTOS_PARSER_REPO);
      this.emitln(`  static load(repo: AptosParserRepo, client: AptosClient, address: HexString, typeParams: TypeTag[]) {`);
      this.emitln(`    return repo.loadResource(client, address, ${struct.name}, typeParams) as unknown as ${struct.name};`);
      this.emitln(`  }`);
      this.emitln("");
    }

    // closes class
    this.emitln(`}`);

  }

  generateScriptFunction(func: JsonFuncType, module: JsonModuleType) {
    this.imports.add(IMPORT.APTOS_CLIENT);
    this.imports.add(IMPORT.APTOS_ACCOUNT);
    this.emitln(`export async function ${func.name}(`);
    this.emitln("  client: AptosClient,");
    this.emitln("  account: AptosAccount,");
    // FIXME: how do we handle multiple &signer cases?
    const paramsWithoutSigners = func.params.filter(a=>a.type !== "&signer" && a.type !== 'signer');
    paramsWithoutSigners.forEach(param => {
      const tag = parseTypeTagOrThrow(param.type);
      const ALLOW_STRUCT = false;
      // FIXME: what if tag is a type-parameter? In this case, the tsType will be "any", and we will need to use 
      // information in "typeParams" to figure out how to interpret the parameter
      let tsType = this.typeTagToTsType(tag, module, ALLOW_STRUCT);
      this.emitln(`  ${param.name}: ${tsType},`);
    });
    this.imports.add(IMPORT.TYPETAG);
    this.imports.add(IMPORT.GET_TYPETAG_FULLNAME);
    this.emitln("  typeParams: TypeTag[],");
    this.emitln(") {");
    this.emitln("  const typeParamStrings = typeParams.map(t=>getTypeTagFullname(t));");
    this.imports.add(IMPORT.SEND_AND_WAIT);
    this.emitln("  return sendAndWait(");
    // client
    this.emitln("    client,");
    // account
    this.emitln("    account,"); //
    // funcname
    this.emitln(`    "${module.address}::${module.module}::${func.name}",`);
    // typeArguments
    this.emitln(`    typeParamStrings,`);
    // args
    if (paramsWithoutSigners.length === 0) {
      this.emitln("    []");
    }
    else {
      this.emitln("    [");
      paramsWithoutSigners.forEach(param=>{
        const tag = parseTypeTagOrThrow(param.type);
        const tsHandler = this.getTsHandlerForScriptFunctionParameter(tag, param);
        this.emitln(`      ${tsHandler},`);
      });
      this.emitln("    ]");
    }
    // close call to sendAndWait
    this.emitln("  );");
    // close function
    this.emitln("}");
  }

  getTsHandlerForScriptFunctionParameter(tag: TypeTag, param: JsonFuncParamType) {
    if(!AptosTsgen.isAcceptableConstantType(tag)) {
      throw new Error(`This is not an acceptable type for script function parameter: ${JSON.stringify(tag)}`);
    }
    if (tag instanceof VectorTag) {
      // vector<u8> came in as number[], gets converted to HexString
      // TODO: provide a special type called AptosVecU8 to handle this mess specifically?
      if (tag.elementType === AtomicTypeTag.U8) {
        return `HexString.fromUint8Array(new Uint8Array(${param.name})).hex()`;
      }
      /*
      actual array value
      - number[]: 
      - HexString[] for vector<address>
      - BigInteger[] for vector<u64/128>
      - boolean[] for vector<bool>, which is just good
      */
      if (tag.elementType === AtomicTypeTag.U64 || tag.elementType === AtomicTypeTag.U128) {
        return `${param.name}.map(bigi => bigi.toString())`
      }
      else if (tag.elementType === AtomicTypeTag.Bool) {
        // bool[]
        return param.name;
      }
      else if (tag.elementType === AtomicTypeTag.Address) {
        // HexString[]
        return param.name;
      }
      else {
        // vector<T>
        // vector<vector<u8>>
        throw new Error(`This vector type is not supported as script function argument: ${JSON.stringify(tag)}`);
      }
    }
    else if (tag instanceof StructTag) {
      throw new Error(`Struct type cannot be used as argument to script functions: ${JSON.stringify(tag)}`);
    }
    else if (tag instanceof TypeParamIdx) {
      // FIXME: extra handler needed
      throw new Error("Type parameter in script function signature currently not supported by tsgen");
    }
    else if (tag === AtomicTypeTag.Address) {
      return `new HexString(${param.name})`
    }
    else if (tag === AtomicTypeTag.Bool) {
      return param.name; // nothing needed
    }
    else if (tag === AtomicTypeTag.U8) {
      return param.name; // nothing needed
    }
    else if ([AtomicTypeTag.U64, AtomicTypeTag.U128].includes(tag)) {
      // use string literal
      return `${param.name}.toString()`;
    }
    else {
      throw new Error(`Unsupported type for script function parameter: ${JSON.stringify(tag)}`);
    }
  }

  static isAcceptableConstantType(tag: TypeTag): boolean {
    if (tag instanceof StructTag) {
      return false;
    }
    else if (tag instanceof VectorTag) {
      return AptosTsgen.isAcceptableConstantType(tag.elementType);
    }
    else if (tag instanceof TypeParamIdx) {
      // FIXME: actually, script functions do support type parameters as argument type
      return false;
    }
    else {
      return [
        AtomicTypeTag.Address, 
        AtomicTypeTag.Bool, 
        AtomicTypeTag.U128, 
        AtomicTypeTag.U64, 
        AtomicTypeTag.U8
      ].includes(tag);
    }
  }

  addJsonIncludeDir(jsonDir: string) {
    this.jsonIncludeDirs.push(jsonDir);
  }

  emitln(line: string) {
    this.lines.push(line);
  }
}
