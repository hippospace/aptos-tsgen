import { AtomicTypeTag, getTypeTagParamlessName, StructTag, TypeTag, TypeParamIdx, VectorTag, getTypeTagFullname, parseTypeTag, parseTypeTagOrThrow } from "./typeTag";
import { AptosClient, HexString } from "aptos";
import bigInt from "big-integer";
import Decimal from "decimal.js";

export type TypeParamDeclType = {
  name: string;
  isPhantom: boolean;
}
export type FieldDeclType = {
  name: string;
  typeTag: TypeTag;
}
export interface StructInfoType {
  moduleAddress: HexString;
  moduleName: string;
  name: string;
  typeParameters: TypeParamDeclType[];
  fields: FieldDeclType[];
  new(proto: any, typeTag: TypeTag): any;
}

export function parseStructProto(data: any, typeTag: TypeTag, repo: AptosParserRepo, struct: StructInfoType): any {
  if(!(typeTag instanceof StructTag)) {
    throw new Error(`${struct.name} expects a StructTag as typeTag but received: ${typeTag}`);
  }
  if(typeTag.address.hex() !== struct.moduleAddress.hex()) {
    throw new Error(`${struct.name} expects a moduleAddress of ${struct.moduleAddress} but received: ${typeTag.address}.`);
  }
  if(typeTag.module !== struct.moduleName) {
    throw new Error(`${struct.name} expects a moduleName of ${struct.moduleName} but received: ${typeTag.module}`);
  }
  if(typeTag.name !== struct.name) {
    throw new Error(`${struct.name} expects a struct name of "${struct.name}" but received: ${typeTag.name}`);
  }
  if(typeof data !== "object") {
    // could be 0x1::ASCII::String
    if (typeTag.address.toShortString() === '0x1' && typeTag.module === 'ASCII' && typeTag.name === 'String') {
      // return the raw string
      return data;
    }
    throw new Error(`${struct.name} expects data to be an object, but instead got: ${typeof data}`);
  }

  // check all keys exist
  let proto: any = {};
  for(const fieldDecl of struct.fields) {
    const fieldName = fieldDecl.name;
    if(!(fieldName in data)) {
      throw new Error(`${struct.name} expects a field named ${fieldName} but it does not exist`);
    }
    const fieldTypeTag = 
        fieldDecl.typeTag instanceof TypeParamIdx? typeTag.typeParams[fieldDecl.typeTag.index] : fieldDecl.typeTag;
    if(!fieldTypeTag) {
      console.log(JSON.stringify(typeTag.typeParams));
      console.log(JSON.stringify(fieldDecl.typeTag));
      throw new Error("BAD ParamIdx, see console log for details");
    }
    const parser = repo.getParserFromTypeTag(fieldTypeTag);
    if(!parser) {
      throw new Error(`Failed to find parser for ${fieldName} with type: ${fieldTypeTag}`);
    }
    const parsedValue = parser(data[fieldName], fieldTypeTag, repo);
    proto[fieldName] = parsedValue;
  }
  return proto;
}

export type ParserFunc = (data: any, typeTag: TypeTag, repo: AptosParserRepo) => any;

export function U8Parser(data: any, typeTag: TypeTag, _repo: AptosParserRepo):number {
  if(typeTag !== AtomicTypeTag.U8) {
    throw new Error(`U8Parser cannot parse type: ${getTypeTagParamlessName(typeTag)}`);
  }
  if(typeof data !== "number") {
    throw new Error(`U8Parser expects number type as data but received: ${typeof data}`);
  }
  if(data < 0 || data > 255) {
    throw new Error(`U8Parser expects a number between 0 and 255, but received: ${data}`);
  }
  if(!Number.isInteger(data)) {
    throw new Error(`U8Parser expects an integer but received: ${data}`);
  }
  return data as number;
}

export function U64Parser(data: any, typeTag: TypeTag, _repo: AptosParserRepo): bigInt.BigInteger {
  if(typeTag !== AtomicTypeTag.U64) {
    throw new Error(`U64Parser cannot parse type: ${getTypeTagParamlessName(typeTag)}`);
  }
  if(typeof data !== "string") {
    throw new Error(`U64Parser expects string type as data but received: ${typeof data}`);
  }
  return bigInt(data);
}

export function U128Parser(data: any, typeTag: TypeTag, _repo: AptosParserRepo): bigInt.BigInteger {
  if(typeTag !== AtomicTypeTag.U128) {
    throw new Error(`U128Parser cannot parse type: ${getTypeTagParamlessName(typeTag)}`);
  }
  if(typeof data !== "string") {
    throw new Error(`U128Parser expects string type as data but received: ${typeof data}`);
  }
  return bigInt(data);
}

export function BoolParser(data: any, typeTag: TypeTag, _repo: AptosParserRepo): boolean {
  if(typeTag !== AtomicTypeTag.Bool) {
    throw new Error(`BoolParser cannot parse type: ${getTypeTagParamlessName(typeTag)}`);
  }
  if(typeof data !== "boolean") {
    throw new Error(`BoolParser expects bool type as data but received: ${typeof data}`);
  }
  return data as boolean;
}

export function AddressParser(data: any, typeTag: TypeTag, _repo: AptosParserRepo): HexString {
  if(typeTag !== AtomicTypeTag.Address) {
    throw new Error(`AddressParser cannot parse type: ${getTypeTagParamlessName(typeTag)}`);
  }
  if(typeof data !== "string") {
    throw new Error(`AddressParser expects string type as data but received: ${typeof data}`);
  }
  return new HexString(data);
}

export function parseVectorU8(data: any): Uint8Array {
  if(typeof data !== "string") {
    throw new Error(`VectorU8 parser expects string data but received: ${typeof data}`);
  }
  if(!data.startsWith('0x')) {
    throw new Error(`VectorU8 value is supposed to start with 0x but instead got: ${data}`);
  }
  const hexString = new HexString(data);
  return hexString.toUint8Array();
}

export function AsciiParser(data: any, typeTag: TypeTag, _repo: AptosParserRepo): string {
  const tagName = getTypeTagFullname(typeTag);
  if (tagName !== '0x1::ASCII::String') {
    throw new Error(`AsciiParser only supports 0x1::ASCII::String but received: ${tagName}`);
  }
  return data as string;
}

export class AptosVectorU8 {
  u8Array: Uint8Array;
  constructor(input: number[] | string | Uint8Array) {
    if(input instanceof Uint8Array) {
      this.u8Array = input;
    }
    else if (typeof input === 'string') {
      this.u8Array = new TextEncoder().encode(input);
    }
    else {
      this.u8Array = new Uint8Array(input);
    }
  }

  toString() {
    return new TextDecoder().decode(this.u8Array);
  }

  toHexString() : HexString {
    return HexString.fromUint8Array(this.u8Array);
  }

  hex(): string {
    return HexString.fromUint8Array(this.u8Array).hex();
  }

  asNumbers() {
    return Array.from(this.u8Array);
  }
}

export function numbersOrStringToHexString(input: number[] | Uint8Array | string ): HexString {
  if(typeof input === 'string') {
    return HexString.fromUint8Array(new TextEncoder().encode(input));
  }
  else if(input instanceof Uint8Array) {
    return HexString.fromUint8Array(input);
  }
  else {
    // number[]
    return HexString.fromUint8Array(new Uint8Array(input));
  }
}

export function VectorParser(data: any, typeTag: TypeTag, repo: AptosParserRepo): any[] {
  if(!(typeTag instanceof VectorTag)) {
    throw new Error(`VectorParser cannot parse type: ${getTypeTagParamlessName(typeTag)}`);
  }
  const elementType = typeTag.elementType;
  if (elementType === AtomicTypeTag.U8) {
    // vector<u8> data comes in hex string form
    const u8array = parseVectorU8(data);
    return Array.from(u8array);
  }
  if(!(data instanceof Array)) {
    throw new Error(`VectorParser expects Array type as data but received: ${typeof data}`);
  }
  const elementTypeParamlessName = getTypeTagParamlessName(elementType);
  const elementParser = repo.getParserFromParamlessName(elementTypeParamlessName);
  if (!elementParser) {
    throw new Error(`No parser exists for type: ${elementTypeParamlessName}`);
  }
  const vector = [];
  for(const element of data) {
    vector.push(elementParser(element, elementType, repo));
  }
  return vector;
}

export class AptosParserRepo {
  paramlessNameToParser: Record<string, ParserFunc>;
  constructor() {
    this.paramlessNameToParser = {};
  }
  async loadResource(client: AptosClient, address: HexString, structTsType: StructInfoType, typeParams: TypeTag[]) {
    // make a concrete typeTag
    if(structTsType.typeParameters.length !== typeParams.length) {
      throw new Error(`Expected ${structTsType.typeParameters.length} type parameters but got ${typeParams.length}`);
    }
    const typeTag = new StructTag(structTsType.moduleAddress, structTsType.moduleName, structTsType.name, typeParams);
    const resource = await client.getAccountResource(address, getTypeTagFullname(typeTag));
    const proto = parseStructProto(resource.data, typeTag, this, structTsType);
    return new structTsType(proto, typeTag);
  }
  async loadEvents(
    client: AptosClient, 
    address: HexString, 
    containerTypeTag: TypeTag, 
    field: string,
    query?: { start?: number; limit?: number },
  ) {
    const handlerFullname = getTypeTagFullname(containerTypeTag);
    if(!(containerTypeTag instanceof StructTag)) {
      throw new Error(`Event handler container struct should be a struct, but received: ${getTypeTagParamlessName(containerTypeTag)}`);
    }
    const events = await client.getEventsByEventHandle(address, handlerFullname, field, query);
    return events.map( e => { 
      const tag = parseTypeTagOrThrow(e.type);
      return this.parse(e.data, tag);
    });
  }
  parse(data: object, typeTag: TypeTag) {
    const paramlessName = getTypeTagParamlessName(typeTag);
    const parser = this.paramlessNameToParser[paramlessName];
    if (!parser) {
      throw new Error(`No parser registered for type: ${paramlessName}`);
    }
    return parser(data, typeTag, this);
  }
  getParserFromParamlessName(paramlessName: string): null | ParserFunc {
    const parser = this.paramlessNameToParser[paramlessName];
    if (parser) {
      return parser;
    }
    return null;
  }
  getParserFromTypeTag(typeTag: TypeTag) {
    const paramlessName = getTypeTagParamlessName(typeTag);
    return this.getParserFromParamlessName(paramlessName);
  }
  addParser(paramlessName: string, parser: ParserFunc) {
    this.paramlessNameToParser[paramlessName] = parser;
  }
  addDefaultParsers() {
    // load the defaults
    this.addParser('bool', BoolParser);
    this.addParser('u8', U8Parser);
    this.addParser('u64', U64Parser);
    this.addParser('u128', U128Parser);
    this.addParser('address', AddressParser);
    this.addParser('vector', VectorParser);
    this.addParser('0x1::ASCII::String', AsciiParser);
  }
}