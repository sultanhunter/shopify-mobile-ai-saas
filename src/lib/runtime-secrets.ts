import { ShopifyCustomerAuthState } from "@/lib/models";

export interface RuntimeDatabaseSecrets {
  provider?: string;
  databaseUrl?: string;
  databaseName?: string;
  roleName?: string;
}

export interface RuntimeShopifySecrets {
  shopDomain?: string;
  adminAccessToken?: string;
  customerAuth?: ShopifyCustomerAuthState;
}

interface RuntimeSecretsRoot {
  runtime?: {
    database?: RuntimeDatabaseSecrets;
  };
  shopify?: RuntimeShopifySecrets;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function parseRuntimeSecrets(value: Record<string, unknown>): RuntimeSecretsRoot {
  const runtime = asRecord(value.runtime);
  const runtimeDatabase = asRecord(runtime.database);
  const shopify = asRecord(value.shopify);

  const parsed: RuntimeSecretsRoot = {
    runtime: {
      database: {
        provider: typeof runtimeDatabase.provider === "string" ? runtimeDatabase.provider : undefined,
        databaseUrl: typeof runtimeDatabase.databaseUrl === "string" ? runtimeDatabase.databaseUrl : undefined,
        databaseName: typeof runtimeDatabase.databaseName === "string" ? runtimeDatabase.databaseName : undefined,
        roleName: typeof runtimeDatabase.roleName === "string" ? runtimeDatabase.roleName : undefined
      }
    },
    shopify: {
      shopDomain: typeof shopify.shopDomain === "string" ? shopify.shopDomain : undefined,
      adminAccessToken: typeof shopify.adminAccessToken === "string" ? shopify.adminAccessToken : undefined,
      customerAuth:
        shopify.customerAuth && typeof shopify.customerAuth === "object"
          ? (shopify.customerAuth as ShopifyCustomerAuthState)
          : undefined
    }
  };

  return parsed;
}
