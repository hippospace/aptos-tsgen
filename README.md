# aptos-tsgen

`aptos-tsgen` uses json output from `jsongen` to generate TypeScript interface for Move modules.

# Example

Move source code:
```move
address 0x1234 {
  module TestModule {
      use Std::Signer;
      use Std::ASCII;
      use Std::FixedPoint32;

      const SOME_ERROR:u64 = 1;
      
      struct AccountInfo has key {
          name: String,
          age: u8,
          balance: u64,
          some_index: FixedPoint32,
      }
      public(script) fun register(account: &signer, name: vector<u8>, age: u8, balance: u64, some_index: u64) {
          let account_info = AccountInfo{
              name: name,
              age: age,
              balance: balance,
              some_index: FixedPoint32 {value: some_index},
          };

          let signer_addr = Signer::address_of(account);

          assert!(!exists<AccountInfo>(signer_addr), SOME_ERROR);
          move_to(account, account_info);
      }
  }
}
```

Output from `jsongen`:
```json
{
  "address": "0x1234",
  "module": "TestModule",
  "constants": [
    { "name": "SOME_ERROR", "type": "u64", "value": "1" }
  ],
  "structs": [
    {
      "name": "AccountInfo",
      "abilities": ["key"],
      "type_params": [],
      "fields": [
        { "name": "name", "type": "0x1::ASCII::String" },
        { "name": "age", "type": "u8" },
        { "name": "balance", "type": "u64" },
        { "name": "some_index", "type": "0x1::FixedPoint32::FixedPoint32" }
      ]
    }
  ],
  "script_functions": [
    {
      "name": "register",
      "type_params": [],
      "params": [
        { "name": "account", "type": "&signer" },
        { "name": "name", "type": "vector<u8>" },
        { "name": "age", "type": "u8" },
        { "name": "balance", "type": "u64" },
        { "name": "some_index", "type": "u64" }
      ]
    }
  ]
}

```

Output from `aptos-tsgen`:
```typescript
import HexString from "aptos";
import bigInt from "big-integer";
import TypeParamDeclType from "@hippospace/aptos-tsgen";
import FieldDeclType from "@hippospace/aptos-tsgen";
import parseTypeTag from "@hippospace/aptos-tsgen";
import TypeTag from "@hippospace/aptos-tsgen";
import AptosParserRepo from "@hippospace/aptos-tsgen";
import parseStructProto from "@hippospace/aptos-tsgen";
import AptosClient from "aptos";
import AptosAccount from "aptos";
import * as X0x1 from "../../X0x1";

export const moduleAddress = new HexString("0x1234");
export const moduleName = "TestModule";

export const SOME_ERROR: bigInt.BigInteger = bigInt("1");

export class AccountInfo {
  static moduleAddress = moduleAddress;
  static moduleName = moduleName;
  static structName: string = "AccountInfo";
  static typeParameters: TypeParamDeclType[] = [
  ];
  static fields: FieldDeclType[] = [
    {name: name, typeTag: parseTypeTag("0x1::ASCII::String")},
    {name: age, typeTag: parseTypeTag("u8")},
    {name: balance, typeTag: parseTypeTag("u64")},
    {name: some_index, typeTag: parseTypeTag("0x1::FixedPoint32::FixedPoint32")}
  ];

  name: string;
  age: number;
  balance: bigInt.BigInteger;
  some_index: X0x1.FixedPoint32.FixedPoint32;

  constructor(proto: any, public typeTag: TypeTag) {
    this.name = proto['name'] as string;
    this.age = proto['age'] as number;
    this.balance = proto['balance'] as bigInt.BigInteger;
    this.some_index = proto['some_index'] as X0x1.FixedPoint32.FixedPoint32;
  }

  static AccountInfoParser(data:any, typeTag: TypeTag, repo: AptosParserRepo) : AccountInfo {
    const proto = parseStructProto(data, typeTag, repo, AccountInfo);
    return new AccountInfo(proto, typeTag);
  }
}

export async function register(
  client: AptosClient,
  account: AptosAccount,
  name: number[],
  age: number,
  balance: bigInt.BigInteger,
  some_index: bigInt.BigInteger,
  typeParams: TypeTag[],
) {
  const typeParamStrings = typeParams.map(t=>getTypeTagFullname(t));
  return sendAndWait(
    client,
    account,
    "0x1234::TestModule::register",
    typeParamStrings,
    [
      HexString.fromUintArray(new Uint8Array(name)).hex(),
      age,
      balance.toString(),
      some_index.toString(),
    ]
  );
}

```

# Type mapping
Here's how we map Aptos' native types to TypeScript types:
- `bool` to `boolean`
- `u8` to `number`
- `u64` to `BigInteger`
- `u128` to `BigInteger`
- `address` to `HexString`
- `Std::ASCII::String` to `string`
- `Std::FixedPoint32::FixedPoint32` to `Decimal`
- `vector<u8>` to `number[]`
- `vector<T>` to `T[]`
- `struct` to `class`
- `struct A<T1,T2>` to `class A`


# Module-level named constants

We only support named constants of type `bool`, `u8`, `u64`, `u128`, `address` at the module-level.
