interface ShopifyBaselineInput {
  projectId: string;
  projectName: string;
  shopDomain: string;
  mobileAppDir: string;
  expoBackendDir?: string;
  expoBackendPort?: number;
  backendDir?: string;
  backendPort?: number;
  brandColor: string;
}

function escapeTemplateLiteral(value: string): string {
  return value.replace(/`/g, "\\`");
}

function normalizeWorkspaceDir(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "." || trimmed === "./") {
    return ".";
  }

  return trimmed.replace(/^\.\//, "").replace(/\/$/, "") || fallback;
}

function toWorkspacePath(rootDir: string, childPath: string): string {
  if (rootDir === ".") {
    return childPath;
  }

  return `${rootDir}/${childPath}`;
}

function resolveExpoBackendDir(input: ShopifyBaselineInput): string {
  return normalizeWorkspaceDir(input.expoBackendDir ?? input.backendDir, "expo-backend");
}

function resolveExpoBackendPort(input: ShopifyBaselineInput): number {
  const port = input.expoBackendPort ?? input.backendPort;
  return Number.isFinite(port) && Number(port) > 0 ? Number(port) : 4100;
}

function renderAppLayout(): string {
  return `import { Stack } from "expo-router";
import { CartProvider } from "../src/features/cart/cart-context";
import { AuthProvider } from "../src/features/auth/auth-provider";
import { ShopifyProvider } from "../src/features/shopify/shopify-provider";

export default function RootLayout() {
  return (
    <ShopifyProvider>
      <AuthProvider>
        <CartProvider>
          <Stack screenOptions={{ headerBackTitle: "Back" }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="product/[handle]" options={{ title: "Product" }} />
          </Stack>
        </CartProvider>
      </AuthProvider>
    </ShopifyProvider>
  );
}
`;
}

function renderTabsLayout(): string {
  return `import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="search" options={{ title: "Products" }} />
      <Tabs.Screen name="cart" options={{ title: "Cart" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
`;
}

function renderHomeScreen(): string {
  return `import { Link } from "expo-router";
import { ActivityIndicator, FlatList, Image, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { ProductSummary } from "../../src/features/shopify/types";
import { useShopifyCatalog } from "../../src/features/shopify/use-shopify-catalog";

function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link href={{ pathname: "/product/[handle]", params: { handle: product.handle } }} asChild>
      <View style={styles.card}>
        {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.image} /> : <View style={styles.imageFallback} />}
        <Text style={styles.title}>{product.title}</Text>
        <Text style={styles.price}>{"$"}{product.price}</Text>
      </View>
    </Link>
  );
}

export default function HomeScreen() {
  const { data, loading, error, refresh } = useShopifyCatalog();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.heading}>Featured products</Text>
        <Text style={styles.subheading}>Live data from your Shopify store</Text>
      </View>

      {loading ? <ActivityIndicator style={styles.loader} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ProductCard product={item} />}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={loading}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  heading: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  subheading: { marginTop: 4, color: "#334155", fontSize: 13 },
  loader: { marginTop: 12 },
  error: { color: "#b91c1c", paddingHorizontal: 16, marginBottom: 8 },
  list: { padding: 12, gap: 12 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    overflow: "hidden"
  },
  image: { width: "100%", height: 180, backgroundColor: "#e2e8f0" },
  imageFallback: { width: "100%", height: 180, backgroundColor: "#e2e8f0" },
  title: { fontSize: 16, fontWeight: "600", color: "#0f172a", paddingHorizontal: 12, paddingTop: 10 },
  price: { fontSize: 14, color: "#334155", paddingHorizontal: 12, paddingVertical: 10 }
});
`;
}

function renderSearchScreen(): string {
  return `import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { ProductSummary } from "../../src/features/shopify/types";
import { useShopifyCatalog } from "../../src/features/shopify/use-shopify-catalog";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const { data } = useShopifyCatalog();

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data;
    return data.filter((item) => item.title.toLowerCase().includes(normalized));
  }, [data, query]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search products"
          style={styles.input}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }: { item: ProductSummary }) => (
          <Link href={{ pathname: "/product/[handle]", params: { handle: item.handle } }} asChild>
            <View style={styles.row}>
              <Text style={styles.name}>{item.title}</Text>
              <Text style={styles.price}>{"$"}{item.price}</Text>
            </View>
          </Link>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },
  searchWrap: { padding: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  row: { paddingHorizontal: 14, paddingVertical: 14, backgroundColor: "#ffffff" },
  name: { fontSize: 15, color: "#0f172a", fontWeight: "600" },
  price: { marginTop: 6, color: "#334155" },
  separator: { height: 1, backgroundColor: "#e2e8f0" }
});
`;
}

function renderCartScreen(): string {
  return `import { Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useCart } from "../../src/features/cart/cart-context";

export default function CartScreen() {
  const { lines, subtotal, checkoutUrl, removeLine, increment, decrement } = useCart();

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.heading}>Your cart</Text>

      {lines.length === 0 ? <Text style={styles.empty}>Your cart is empty.</Text> : null}

      {lines.map((line) => (
        <View key={line.variantId} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>{line.title}</Text>
            <Text style={styles.meta}>{"$"}{line.price} x {line.quantity}</Text>
          </View>

          <View style={styles.controls}>
            <TouchableOpacity style={styles.smallBtn} onPress={() => decrement(line.variantId)}>
              <Text style={styles.smallBtnLabel}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtn} onPress={() => increment(line.variantId)}>
              <Text style={styles.smallBtnLabel}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.removeBtn} onPress={() => removeLine(line.variantId)}>
              <Text style={styles.removeBtnLabel}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <View style={styles.footer}>
        <Text style={styles.total}>Subtotal: {"$"}{subtotal.toFixed(2)}</Text>
        <TouchableOpacity
          style={[styles.checkoutBtn, !checkoutUrl && styles.checkoutBtnDisabled]}
          disabled={!checkoutUrl}
          onPress={() => {
            if (checkoutUrl) {
              void Linking.openURL(checkoutUrl);
            }
          }}
        >
          <Text style={styles.checkoutBtnLabel}>Checkout</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc", padding: 12 },
  heading: { fontSize: 24, fontWeight: "700", color: "#0f172a", marginBottom: 12 },
  empty: { color: "#475569", marginTop: 8 },
  row: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, marginBottom: 10 },
  rowMain: { marginBottom: 8 },
  name: { fontSize: 15, fontWeight: "600", color: "#0f172a" },
  meta: { marginTop: 4, color: "#475569" },
  controls: { flexDirection: "row", gap: 8 },
  smallBtn: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, width: 34, alignItems: "center", justifyContent: "center" },
  smallBtnLabel: { fontSize: 18, color: "#0f172a" },
  removeBtn: { borderWidth: 1, borderColor: "#fca5a5", borderRadius: 8, paddingHorizontal: 10, justifyContent: "center" },
  removeBtnLabel: { color: "#b91c1c", fontWeight: "600" },
  footer: { marginTop: "auto", paddingTop: 12 },
  total: { fontSize: 18, fontWeight: "700", color: "#0f172a", marginBottom: 10 },
  checkoutBtn: { backgroundColor: "#0f766e", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  checkoutBtnDisabled: { backgroundColor: "#94a3b8" },
  checkoutBtnLabel: { color: "#fff", fontWeight: "700", fontSize: 16 }
});
`;
}

function renderAccountScreen(): string {
  return `import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AuthMethod } from "../../src/features/auth/types";
import { useAuth } from "../../src/features/auth/auth-provider";

function MethodButton({
  label,
  method,
  activeMethod,
  enabled,
  onPress
}: {
  label: string;
  method: AuthMethod;
  activeMethod: AuthMethod;
  enabled: boolean;
  onPress: (method: AuthMethod) => void;
}) {
  const active = activeMethod === method;
  return (
    <TouchableOpacity
      style={[styles.methodBtn, active && styles.methodBtnActive, !enabled && styles.methodBtnDisabled]}
      disabled={!enabled}
      onPress={() => onPress(method)}
    >
      <Text style={[styles.methodBtnLabel, active && styles.methodBtnLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function AccountScreen() {
  const {
    status,
    session,
    config,
    error,
    activeMethod,
    setActiveMethod,
    signIn,
    completeSignIn,
    signOut,
    isLoading,
    pendingSessionId,
    lastPolledSessionId,
    lastCompletedSessionId
  } = useAuth();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Account</Text>
        <Text style={styles.meta}>Status: {status}</Text>
        <Text style={styles.meta}>Active method: {activeMethod}</Text>

        <View style={styles.methodsWrap}>
          <MethodButton
            label="Hosted"
            method="shopify_hosted"
            activeMethod={activeMethod}
            enabled={config.supportedMethods.includes("shopify_hosted")}
            onPress={setActiveMethod}
          />
          <MethodButton
            label="Customer API"
            method="customer_account_api"
            activeMethod={activeMethod}
            enabled={config.supportedMethods.includes("customer_account_api")}
            onPress={setActiveMethod}
          />
        </View>

        <TouchableOpacity style={styles.primaryBtn} disabled={isLoading} onPress={() => void signIn()}>
          <Text style={styles.primaryBtnLabel}>{isLoading ? "Working..." : "Sign in"}</Text>
        </TouchableOpacity>

        {status === "awaiting_completion" ? (
          <TouchableOpacity style={styles.secondaryBtn} disabled={isLoading} onPress={() => void completeSignIn()}>
            <Text style={styles.secondaryBtnLabel}>I finished in browser, continue</Text>
          </TouchableOpacity>
        ) : null}

        {session ? (
          <TouchableOpacity style={styles.secondaryBtn} disabled={isLoading} onPress={() => void signOut()}>
            <Text style={styles.secondaryBtnLabel}>Sign out</Text>
          </TouchableOpacity>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {session ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Session</Text>
            <Text style={styles.cardText}>Method: {session.method}</Text>
            <Text style={styles.cardText}>Signed in at: {session.signedInAt ?? "n/a"}</Text>
            <Text style={styles.cardText}>Token scope: {session.tokens?.scope ?? "n/a"}</Text>
            <Text style={styles.cardText}>Expires: {session.tokens?.expiresAt ?? "n/a"}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Detected store setup</Text>
          <Text style={styles.cardText}>Hosted account type: {config.hosted.accountType}</Text>
          <Text style={styles.cardText}>Hosted enabled: {String(config.hosted.accountsEnabled)}</Text>
          <Text style={styles.cardText}>Customer API enabled: {String(config.customerAccountApi.enabled)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Auth debug</Text>
          <Text style={styles.cardText}>Pending session ID: {pendingSessionId ?? "n/a"}</Text>
          <Text style={styles.cardText}>Last polled session ID: {lastPolledSessionId ?? "n/a"}</Text>
          <Text style={styles.cardText}>Last completed session ID: {lastCompletedSessionId ?? "n/a"}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 14, gap: 10 },
  heading: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  meta: { color: "#334155" },
  methodsWrap: { flexDirection: "row", gap: 8 },
  methodBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  methodBtnActive: {
    borderColor: "#0f766e",
    backgroundColor: "#ccfbf1"
  },
  methodBtnDisabled: {
    opacity: 0.5
  },
  methodBtnLabel: { color: "#0f172a", fontWeight: "600" },
  methodBtnLabelActive: { color: "#115e59" },
  primaryBtn: {
    marginTop: 6,
    backgroundColor: "#0f766e",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 12
  },
  primaryBtnLabel: { color: "#ffffff", fontWeight: "700", fontSize: 16 },
  secondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    alignItems: "center",
    paddingVertical: 10
  },
  secondaryBtnLabel: { color: "#0f172a", fontWeight: "600" },
  error: { color: "#b91c1c" },
  card: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 12,
    gap: 6
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  cardText: { color: "#334155" }
});
`;
}

function renderProductScreen(): string {
  return `import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useCart } from "../../src/features/cart/cart-context";
import { useShopify } from "../../src/features/shopify/shopify-provider";
import { ProductDetail } from "../../src/features/shopify/types";

export default function ProductScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addLine } = useCart();
  const { fetchProductByHandle } = useShopify();

  useEffect(() => {
    let ignore = false;

    async function load() {
      if (!handle) return;
      setLoading(true);
      setError(null);

      try {
        const next = await fetchProductByHandle(handle);
        if (!ignore) {
          setProduct(next);
        }
      } catch (caught) {
        if (!ignore) {
          setError(caught instanceof Error ? caught.message : "Failed to load product");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [handle]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (error || !product) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.error}>{error ?? "Product not found"}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.image} /> : null}
        <Text style={styles.title}>{product.title}</Text>
        <Text style={styles.price}>{"$"}{product.price}</Text>
        {product.description ? <Text style={styles.description}>{product.description}</Text> : null}

        <TouchableOpacity
          style={styles.cta}
          onPress={() => {
            addLine({
              variantId: product.variantId,
              title: product.title,
              price: product.price,
              quantity: 1
            });
          }}
        >
          <Text style={styles.ctaLabel}>Add to cart</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  error: { color: "#b91c1c" },
  content: { padding: 16, gap: 10 },
  image: { width: "100%", height: 260, borderRadius: 12, backgroundColor: "#e2e8f0" },
  title: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  price: { fontSize: 20, fontWeight: "700", color: "#0f766e" },
  description: { fontSize: 14, lineHeight: 20, color: "#334155" },
  cta: { marginTop: 12, backgroundColor: "#0f766e", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  ctaLabel: { color: "#ffffff", fontWeight: "700", fontSize: 16 }
});
`;
}

function renderStoreConfig(input: ShopifyBaselineInput): string {
  return `const injectedExpoBackendBaseUrl = process.env.EXPO_PUBLIC_RUNTIME_BACKEND_URL?.trim() || "";

export const storeConfig = {
  projectId: ${JSON.stringify(input.projectId)},
  projectName: ${JSON.stringify(input.projectName)},
  shopDomain: ${JSON.stringify(input.shopDomain)},
  expoBackendBaseUrl: injectedExpoBackendBaseUrl,
  runtimeBackendBaseUrl: injectedExpoBackendBaseUrl,
  brandColor: ${JSON.stringify(input.brandColor)}
} as const;
`;
}

function renderShopifyTypes(): string {
  return `export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  imageUrl?: string;
  price: number;
  variantId: string;
}

export interface ProductDetail extends ProductSummary {
  description?: string;
}
`;
}

function renderShopifyApi(): string {
  return `import { storeConfig } from "./store-config";
import { ProductDetail, ProductSummary } from "./types";

function apiUrl(path: string): string {
  const root = storeConfig.expoBackendBaseUrl.replace(/\\/$/, "");
  if (!root) {
    throw new Error("Missing EXPO_PUBLIC_RUNTIME_BACKEND_URL. Start the dev session from SaaS so runner injects the Expo backend URL.");
  }

  return root + path;
}

export async function fetchCatalog(): Promise<ProductSummary[]> {
  const response = await fetch(apiUrl("/api/catalog"));
  const payload = (await response.json().catch(() => null)) as
    | { products?: ProductSummary[]; error?: string }
    | null;

  if (!response.ok || !payload?.products) {
    throw new Error(payload?.error ?? "Failed to fetch Shopify catalog");
  }

  return payload.products;
}

export async function fetchProductByHandle(handle: string): Promise<ProductDetail> {
  const response = await fetch(apiUrl("/api/products/" + encodeURIComponent(handle)));
  const payload = (await response.json().catch(() => null)) as
    | { product?: ProductDetail; error?: string }
    | null;

  if (!response.ok || !payload?.product) {
    throw new Error(payload?.error ?? "Failed to fetch Shopify product");
  }

  return payload.product;
}
`;
}

function renderRuntimeBackendPackageJson(): string {
  return JSON.stringify(
    {
      name: "shopify-mobile-expo-backend",
      private: true,
      type: "module",
      scripts: {
        dev: "node --watch src/index.js",
        start: "node src/index.js"
      },
      dependencies: {
        cors: "^2.8.5",
        dotenv: "^16.4.5",
        express: "^4.19.2",
        pg: "^8.13.1"
      }
    },
    null,
    2
  );
}

function renderRuntimeBackendGitIgnore(): string {
  return `node_modules/
.env
`;
}

function renderRuntimeBackendEnvExample(input: ShopifyBaselineInput): string {
  return `PORT=${resolveExpoBackendPort(input)}
PROJECT_ID=${input.projectId}
DATABASE_URL=
API_TIMEOUT_MS=15000
RUNTIME_SYNC_TOKEN=
`;
}

function renderRuntimeBackendReadme(input: ShopifyBaselineInput): string {
  return `# Expo Backend

This backend powers the generated Expo storefront app for project \`${input.projectId}\`.

## What this service does

- Exposes mobile-friendly API endpoints for catalog and customer auth
- Keeps backend logic in the workspace instead of the SaaS frontend server
- Uses runtime sync to receive project config/secrets from control-plane

## Start locally

1. Copy environment file

\`\`\`bash
cp .env.example .env
\`\`\`

2. Install dependencies

\`\`\`bash
npm install
\`\`\`

3. Start expo backend

\`\`\`bash
npm run dev
\`\`\`

The API starts on \`http://localhost:4100\` by default.

## Endpoints

- \`GET /api/health\`
- \`GET /api/catalog\`
- \`GET /api/products/:handle\`
- \`GET /api/customer-auth/config\`
- \`POST /api/customer-auth/method\`
- \`POST /api/customer-auth/start\`
- \`GET /api/customer-auth/session/:sessionId\`
- \`POST /api/customer-auth/refresh\`
- \`POST /internal/runtime/sync\`
`;
}

function renderRuntimeBackendConfig(input: ShopifyBaselineInput): string {
  return `import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PROJECT_ID = ${JSON.stringify(input.projectId)};
const DEFAULT_PORT = ${resolveExpoBackendPort(input)};
const DEFAULT_TIMEOUT_MS = 15000;

function asString(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const runtimeConfig = {
  port: asNumber(process.env.PORT, DEFAULT_PORT),
  projectId: asString(process.env.PROJECT_ID, DEFAULT_PROJECT_ID),
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  timeoutMs: asNumber(process.env.API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  runtimeSyncToken: process.env.RUNTIME_SYNC_TOKEN?.trim() || undefined,
};

if (!runtimeConfig.projectId) {
  throw new Error("PROJECT_ID is required for expo backend.");
}
`;
}

function renderRuntimeBackendRuntimeStateStore(): string {
  return `import { Pool } from "pg";

const STATE_ROW_ID = "runtime";

let memoryState = {
  version: 0,
  config: {},
  secrets: {}
};

let pool;
let poolDatabaseUrl;

function resolveRuntimeStateDatabaseUrl(config, candidateState) {
  const fromConfig = typeof config?.databaseUrl === "string" ? config.databaseUrl.trim() : "";
  if (fromConfig) {
    return fromConfig;
  }

  const fromCandidate =
    typeof candidateState?.secrets?.runtime?.database?.databaseUrl === "string"
      ? candidateState.secrets.runtime.database.databaseUrl.trim()
      : "";
  if (fromCandidate) {
    return fromCandidate;
  }

  const fromMemory =
    typeof memoryState?.secrets?.runtime?.database?.databaseUrl === "string"
      ? memoryState.secrets.runtime.database.databaseUrl.trim()
      : "";

  return fromMemory || undefined;
}

function createPool(databaseUrl) {
  return new Pool({
    connectionString: databaseUrl,
    max: 2,
    ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false }
  });
}

function getPool(config, candidateState) {
  const databaseUrl = resolveRuntimeStateDatabaseUrl(config, candidateState);
  if (!databaseUrl) {
    return undefined;
  }

  if (!pool || poolDatabaseUrl !== databaseUrl) {
    if (pool) {
      void pool.end().catch(() => null);
    }

    pool = createPool(databaseUrl);
    poolDatabaseUrl = databaseUrl;
  }

  return pool;
}

async function ensureSchema(currentPool) {
  await currentPool.query(
    "create table if not exists runtime_sync_state (id text primary key, version bigint not null default 0, config_json jsonb not null default '{}'::jsonb, secrets_json jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now())"
  );
}

export async function initRuntimeStateStore(config) {
  const currentPool = getPool(config, memoryState);
  if (!currentPool) {
    return;
  }

  await ensureSchema(currentPool);
}

export async function getRuntimeState(config) {
  const currentPool = getPool(config, memoryState);
  if (!currentPool) {
    return memoryState;
  }

  await ensureSchema(currentPool);
  const result = await currentPool.query(
    "select id, version, config_json, secrets_json from runtime_sync_state where id = $1 limit 1",
    [STATE_ROW_ID]
  );

  const row = result.rows[0];
  if (!row) {
    await currentPool.query(
      "insert into runtime_sync_state (id, version, config_json, secrets_json) values ($1, 0, '{}'::jsonb, '{}'::jsonb)",
      [STATE_ROW_ID]
    );

    return {
      version: 0,
      config: {},
      secrets: {}
    };
  }

  return {
    version: Number(row.version ?? 0),
    config: row.config_json ?? {},
    secrets: row.secrets_json ?? {}
  };
}

export async function saveRuntimeState(config, nextState) {
  const normalized = {
    version: Number(nextState.version ?? 0),
    config: nextState.config ?? {},
    secrets: nextState.secrets ?? {}
  };

  const currentPool = getPool(config, normalized);
  if (!currentPool) {
    if (normalized.version < memoryState.version) {
      return memoryState;
    }

    memoryState = normalized;
    return memoryState;
  }

  await ensureSchema(currentPool);
  const current = await getRuntimeState(config);
  if (normalized.version < current.version) {
    return current;
  }

  await currentPool.query(
    "insert into runtime_sync_state (id, version, config_json, secrets_json) values ($1, $2, $3::jsonb, $4::jsonb) on conflict (id) do update set version = excluded.version, config_json = excluded.config_json, secrets_json = excluded.secrets_json, updated_at = now()",
    [STATE_ROW_ID, normalized.version, JSON.stringify(normalized.config), JSON.stringify(normalized.secrets)]
  );

  return normalized;
}
`;
}

function renderRuntimeBackendShopifyAdminClient(): string {
  return `const SHOPIFY_ADMIN_API_VERSION = "2024-10";

function asMoney(value) {
  const parsed = Number(value ?? "0");
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function stripHtml(value) {
  if (!value) return undefined;
  return String(value).replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim();
}

function mapProductSummary(raw) {
  const firstVariant = Array.isArray(raw?.variants) ? raw.variants[0] : undefined;
  if (!raw?.id || !raw?.title || !raw?.handle || !firstVariant?.id) {
    return null;
  }

  const imageUrl = raw?.image?.src || (Array.isArray(raw?.images) ? raw.images[0]?.src : undefined);
  return {
    id: String(raw.id),
    title: String(raw.title),
    handle: String(raw.handle),
    imageUrl,
    price: asMoney(firstVariant.price),
    variantId: String(firstVariant.id)
  };
}

function mapProductDetail(raw) {
  const summary = mapProductSummary(raw);
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    description: stripHtml(raw.body_html)
  };
}

async function shopifyAdminFetch(params) {
  const search = new URLSearchParams(params.query || {});
  const response = await fetch(
    "https://" + params.shopDomain + "/admin/api/" + SHOPIFY_ADMIN_API_VERSION + "/" + params.resourcePath + "?" + search.toString(),
    {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": params.accessToken,
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error("Shopify API request failed with status " + response.status);
  }

  return payload;
}

export async function fetchShopifyCatalog(params) {
  const payload = await shopifyAdminFetch({
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
    resourcePath: "products.json",
    query: {
      limit: String(params.limit ?? 24),
      fields: "id,title,handle,image,images,variants"
    }
  });

  return (Array.isArray(payload?.products) ? payload.products : [])
    .map((product) => mapProductSummary(product))
    .filter(Boolean);
}

export async function fetchShopifyProductByHandle(params) {
  const payload = await shopifyAdminFetch({
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
    resourcePath: "products.json",
    query: {
      handle: params.handle,
      limit: "1",
      fields: "id,title,handle,body_html,image,images,variants"
    }
  });

  const found = Array.isArray(payload?.products) ? payload.products[0] : undefined;
  if (!found) {
    return null;
  }

  return mapProductDetail(found);
}
`;
}

function renderRuntimeBackendCatalogAdapter(): string {
  return `import { getRuntimeState } from "../lib/runtime-state-store.js";
import { fetchShopifyCatalog, fetchShopifyProductByHandle } from "../lib/shopify-admin-client.js";

function readShopifySecrets(runtimeState) {
  const shopify = runtimeState?.secrets?.shopify;
  const shopDomain = typeof shopify?.shopDomain === "string" ? shopify.shopDomain.trim().toLowerCase() : "";
  const accessToken = typeof shopify?.adminAccessToken === "string" ? shopify.adminAccessToken.trim() : "";

  if (!shopDomain || !accessToken) {
    throw new Error("Shopify runtime secrets are missing. Connect store in SaaS and run runtime sync.");
  }

  return { shopDomain, accessToken };
}

export function createCatalogAdapter(config) {
  return {
    async getCatalog() {
      const runtimeState = await getRuntimeState(config);
      const shopify = readShopifySecrets(runtimeState);
      const products = await fetchShopifyCatalog({
        shopDomain: shopify.shopDomain,
        accessToken: shopify.accessToken,
        limit: 24
      });

      return {
        shopDomain: shopify.shopDomain,
        products
      };
    },
    async getProductByHandle(handle) {
      const runtimeState = await getRuntimeState(config);
      const shopify = readShopifySecrets(runtimeState);
      const product = await fetchShopifyProductByHandle({
        shopDomain: shopify.shopDomain,
        accessToken: shopify.accessToken,
        handle
      });

      if (!product) {
        return { error: "Product not found." };
      }

      return { product };
    }
  };
}
`;
}

function renderRuntimeBackendCustomerAuthAdapter(): string {
  return `import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { getRuntimeState, saveRuntimeState } from "../lib/runtime-state-store.js";

const FALLBACK_METHOD = "shopify_hosted";
const SESSION_TTL_MS = 10 * 60 * 1000;

let runtimePool;
let runtimePoolDatabaseUrl;
let runtimeSchemaReady = false;

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) {
    return [];
  }

  return scopes
    .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
    .filter((scope) => scope.length > 0);
}

function createPool(databaseUrl) {
  return new Pool({
    connectionString: databaseUrl,
    max: 4,
    ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false }
  });
}

function getRuntimeDatabaseUrl(runtimeState) {
  const runtimeSecrets = asRecord(runtimeState?.secrets);
  const runtime = asRecord(runtimeSecrets.runtime);
  const database = asRecord(runtime.database);
  const databaseUrl = typeof database.databaseUrl === "string" ? database.databaseUrl.trim() : "";

  if (!databaseUrl) {
    throw new Error("Runtime database URL is missing. Wait for control-plane runtime sync.");
  }

  return databaseUrl;
}

async function getRuntimePool(runtimeState) {
  const databaseUrl = getRuntimeDatabaseUrl(runtimeState);

  if (!runtimePool || runtimePoolDatabaseUrl !== databaseUrl) {
    if (runtimePool) {
      await runtimePool.end().catch(() => null);
    }

    runtimePool = createPool(databaseUrl);
    runtimePoolDatabaseUrl = databaseUrl;
    runtimeSchemaReady = false;
  }

  if (!runtimeSchemaReady) {
    await runtimePool.query(
      "create table if not exists customer_auth_sessions (id text primary key, status text not null, code_verifier text, token_payload_encrypted text, error text, expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())"
    );

    await runtimePool.query(
      "create index if not exists customer_auth_sessions_status_updated_at_idx on customer_auth_sessions (status, updated_at desc)"
    );

    runtimeSchemaReady = true;
  }

  return runtimePool;
}

function getShopifySecrets(runtimeState) {
  const shopify = asRecord(asRecord(runtimeState?.secrets).shopify);
  const shopDomain = typeof shopify.shopDomain === "string" ? shopify.shopDomain.trim().toLowerCase() : "";
  const customerAuth = asRecord(shopify.customerAuth);

  return {
    shopDomain,
    customerAuth,
    hosted: asRecord(customerAuth.hosted),
    customerAccountApi: asRecord(customerAuth.customerAccountApi)
  };
}

function createPkcePair() {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return { codeVerifier, codeChallenge };
}

function createUnsignedState(params) {
  return Buffer.from(
    JSON.stringify({
      projectId: params.projectId,
      shopDomain: params.shopDomain,
      sessionId: params.sessionId,
      nonce: randomBytes(10).toString("base64url"),
      expiresAt: Date.now() + SESSION_TTL_MS
    }),
    "utf8"
  ).toString("base64url");
}

function buildAuthorizeUrl(params) {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("scope", params.scopes.join(" "));
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

function normalizeTokenSet(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid token response payload.");
  }

  if (typeof payload.access_token !== "string" || !payload.access_token.trim()) {
    const fallbackError =
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : "Customer auth token response missing access_token";
    throw new Error(fallbackError);
  }

  let expiresAt;
  if (typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) && payload.expires_in > 0) {
    expiresAt = new Date(Date.now() + payload.expires_in * 1000).toISOString();
  }

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    idToken: typeof payload.id_token === "string" ? payload.id_token : undefined,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : undefined,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
    expiresAt
  };
}

async function postTokenRequest(tokenEndpoint, body) {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const message =
      payload && typeof payload === "object" && typeof payload.error_description === "string"
        ? payload.error_description
        : payload && typeof payload === "object" && typeof payload.error === "string"
          ? payload.error
          : "Failed customer auth token request";
    throw new Error(message);
  }

  return normalizeTokenSet(payload);
}

function parseTokenPayload(raw) {
  if (typeof raw !== "string" || !raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.accessToken !== "string") {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
}

export function createCustomerAuthAdapter(config) {
  return {
    async getConfig() {
      const runtimeState = await getRuntimeState(config);
      const shopify = getShopifySecrets(runtimeState);

      const supportedMethods = Array.isArray(shopify.customerAuth.supportedMethods)
        ? shopify.customerAuth.supportedMethods.filter(
            (method) => method === "shopify_hosted" || method === "customer_account_api"
          )
        : ["shopify_hosted"];

      const recommendedMethod =
        shopify.customerAuth.recommendedMethod === "customer_account_api" &&
        supportedMethods.includes("customer_account_api")
          ? "customer_account_api"
          : FALLBACK_METHOD;

      const configuredActiveMethod =
        shopify.customerAuth.activeMethod === "customer_account_api" &&
        supportedMethods.includes("customer_account_api")
          ? "customer_account_api"
          : FALLBACK_METHOD;

      const activeMethod =
        configuredActiveMethod && supportedMethods.includes(configuredActiveMethod)
          ? configuredActiveMethod
          : recommendedMethod;

      return {
        detectedAt: typeof shopify.customerAuth.detectedAt === "string"
          ? shopify.customerAuth.detectedAt
          : new Date().toISOString(),
        activeMethod,
        recommendedMethod,
        supportedMethods: supportedMethods.length > 0 ? supportedMethods : [FALLBACK_METHOD],
        hosted: {
          accountsEnabled: Boolean(shopify.hosted.accountsEnabled),
          accountType: typeof shopify.hosted.accountType === "string" ? shopify.hosted.accountType : "unknown",
          loginUrl:
            typeof shopify.hosted.loginUrl === "string" && shopify.hosted.loginUrl
              ? shopify.hosted.loginUrl
              : shopify.shopDomain
                ? "https://" + shopify.shopDomain + "/account/login"
                : "",
          accountUrl:
            typeof shopify.hosted.accountUrl === "string" && shopify.hosted.accountUrl
              ? shopify.hosted.accountUrl
              : shopify.shopDomain
                ? "https://" + shopify.shopDomain + "/account"
                : ""
        },
        customerAccountApi: {
          enabled: Boolean(shopify.customerAccountApi.enabled),
          hasClientId: typeof shopify.customerAccountApi.clientId === "string" && shopify.customerAccountApi.clientId.length > 0,
          scopes: normalizeScopes(shopify.customerAccountApi.scopes),
          issuer: typeof shopify.customerAccountApi.issuer === "string" ? shopify.customerAccountApi.issuer : undefined,
          authorizationEndpoint:
            typeof shopify.customerAccountApi.authorizationEndpoint === "string"
              ? shopify.customerAccountApi.authorizationEndpoint
              : undefined,
          tokenEndpoint:
            typeof shopify.customerAccountApi.tokenEndpoint === "string"
              ? shopify.customerAccountApi.tokenEndpoint
              : undefined
        },
        endpoints: {
          start: "/api/customer-auth/start",
          sessionBase: "/api/customer-auth/session",
          refresh: "/api/customer-auth/refresh"
        }
      };
    },
    async setMethod(activeMethod) {
      const runtimeState = await getRuntimeState(config);
      const currentSecrets = asRecord(runtimeState.secrets);
      const currentShopify = asRecord(currentSecrets.shopify);
      const currentCustomerAuth = asRecord(currentShopify.customerAuth);

      const nextCustomerAuth = {
        ...currentCustomerAuth,
        activeMethod
      };

      const nextState = {
        version: runtimeState.version,
        config: runtimeState.config,
        secrets: {
          ...currentSecrets,
          shopify: {
            ...currentShopify,
            customerAuth: nextCustomerAuth
          }
        }
      };

      await saveRuntimeState(config, nextState);
      return { ok: true, activeMethod };
    },
    async start() {
      const runtimeState = await getRuntimeState(config);
      const shopify = getShopifySecrets(runtimeState);
      const pool = await getRuntimePool(runtimeState);

      if (!shopify.shopDomain) {
        throw new Error("Shop domain is missing in runtime secrets.");
      }

      const clientId = typeof shopify.customerAccountApi.clientId === "string" ? shopify.customerAccountApi.clientId : "";
      const authorizationEndpoint =
        typeof shopify.customerAccountApi.authorizationEndpoint === "string"
          ? shopify.customerAccountApi.authorizationEndpoint
          : "";
      const redirectUri = typeof shopify.customerAccountApi.callbackUrl === "string" ? shopify.customerAccountApi.callbackUrl : "";
      const scopes = normalizeScopes(shopify.customerAccountApi.scopes);

      if (!shopify.customerAccountApi.enabled || !clientId || !authorizationEndpoint || !redirectUri) {
        throw new Error("Customer Account API auth is not available for this store.");
      }

      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const pkce = createPkcePair();
      const state = createUnsignedState({
        projectId: config.projectId,
        shopDomain: shopify.shopDomain,
        sessionId
      });

      const authUrl = buildAuthorizeUrl({
        authorizationEndpoint,
        clientId,
        redirectUri,
        scopes,
        state,
        codeChallenge: pkce.codeChallenge
      });

      await pool.query(
        "insert into customer_auth_sessions (id, status, code_verifier, expires_at, created_at, updated_at) values ($1, 'pending', $2, $3, now(), now()) on conflict (id) do update set status = excluded.status, code_verifier = excluded.code_verifier, expires_at = excluded.expires_at, token_payload_encrypted = null, error = null, updated_at = now()",
        [sessionId, pkce.codeVerifier, expiresAt]
      );

      return {
        sessionId,
        status: "pending",
        expiresAt,
        authUrl
      };
    },
    async getSession(sessionId) {
      const runtimeState = await getRuntimeState(config);
      const pool = await getRuntimePool(runtimeState);

      const result = await pool.query(
        "select id, status, code_verifier, token_payload_encrypted, error, expires_at, created_at, updated_at from customer_auth_sessions where id = $1 limit 1",
        [sessionId]
      );

      const row = result.rows[0];
      if (!row) {
        const known = await pool.query(
          "select id from customer_auth_sessions order by created_at desc limit 10"
        );

        return {
          status: "failed",
          error: "Customer auth session not found.",
          requestedSessionId: sessionId,
          knownSessionIds: known.rows
            .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
            .filter(Boolean)
        };
      }

      const status = typeof row.status === "string" ? row.status : "pending";
      const expiresAt =
        typeof row.expires_at === "string"
          ? row.expires_at
          : row.expires_at instanceof Date
            ? row.expires_at.toISOString()
            : "";
      const expiresAtMs = Date.parse(expiresAt);

      if (status === "pending" && Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
        await pool.query(
          "update customer_auth_sessions set status = 'expired', error = coalesce(error, 'Customer auth session expired.'), code_verifier = null, updated_at = now() where id = $1",
          [sessionId]
        );
        return { status: "expired", error: "Customer auth session expired." };
      }

      if (status === "completed") {
        const tokens = parseTokenPayload(row.token_payload_encrypted);
        if (!tokens) {
          return { status: "failed", error: "Completed session is missing token payload." };
        }

        await pool.query(
          "update customer_auth_sessions set status = 'consumed', code_verifier = null, token_payload_encrypted = null, error = null, updated_at = now() where id = $1",
          [sessionId]
        );

        return { status: "completed", tokens };
      }

      if (status === "failed") {
        return { status: "failed", error: typeof row.error === "string" ? row.error : "Customer auth failed." };
      }

      if (status === "expired") {
        return { status: "expired", error: typeof row.error === "string" ? row.error : "Customer auth session expired." };
      }

      if (status === "consumed") {
        return { status: "consumed" };
      }

      return { status: "pending" };
    },
    async refresh(refreshToken) {
      const runtimeState = await getRuntimeState(config);
      const shopify = getShopifySecrets(runtimeState);
      const tokenEndpoint =
        typeof shopify.customerAccountApi.tokenEndpoint === "string"
          ? shopify.customerAccountApi.tokenEndpoint
          : "";
      const clientId = typeof shopify.customerAccountApi.clientId === "string" ? shopify.customerAccountApi.clientId : "";

      if (!tokenEndpoint || !clientId) {
        throw new Error("Customer Account API token refresh is unavailable.");
      }

      const body = new URLSearchParams();
      body.set("grant_type", "refresh_token");
      body.set("client_id", clientId);
      body.set("refresh_token", refreshToken);

      const tokens = await postTokenRequest(tokenEndpoint, body);
      return { tokens };
    }
  };
}
`;
}

function renderRuntimeBackendServer(): string {
  return `import cors from "cors";
import express from "express";
import { runtimeConfig } from "./config.js";
import { createCatalogAdapter } from "./adapters/catalog-adapter.js";
import { createCustomerAuthAdapter } from "./adapters/customer-auth-adapter.js";
import { getRuntimeState, initRuntimeStateStore, saveRuntimeState } from "./lib/runtime-state-store.js";

const app = express();

app.use(
  cors({
    origin: true,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

const catalogAdapter = createCatalogAdapter(runtimeConfig);
const customerAuthAdapter = createCustomerAuthAdapter(runtimeConfig);

await initRuntimeStateStore(runtimeConfig);

function asErrorMessage(caught) {
  return caught instanceof Error ? caught.message : "Request failed";
}

function asyncRoute(handler) {
  return (request, response) => {
    Promise.resolve(handler(request, response)).catch((caught) => {
      response.status(500).json({ error: asErrorMessage(caught) });
    });
  };
}

function isRuntimeSyncAuthorized(request) {
  const expectedToken = runtimeConfig.runtimeSyncToken;
  if (!expectedToken) {
    return true;
  }

  const authorization = request.header("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return false;
  }

  return authorization.slice("Bearer ".length).trim() === expectedToken;
}

function normalizeRuntimeSyncBody(rawBody) {
  const body = rawBody && typeof rawBody === "object" ? rawBody : {};
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const version = Number(body.version ?? NaN);

  if (!projectId) {
    throw new Error("projectId is required.");
  }

  if (!Number.isFinite(version) || version < 0) {
    throw new Error("version must be a non-negative number.");
  }

  return {
    projectId,
    version,
    config: body.config && typeof body.config === "object" ? body.config : {},
    secrets: body.secrets && typeof body.secrets === "object" ? body.secrets : {}
  };
}

app.get(
  "/api/health",
  asyncRoute(async (_request, response) => {
    const runtimeState = await getRuntimeState(runtimeConfig);

    response.json({
      status: "ok",
      projectId: runtimeConfig.projectId,
      runtimeSyncVersion: runtimeState.version,
      runtimeDatabaseConfigured: Boolean(runtimeState?.secrets?.runtime?.database?.databaseUrl)
    });
  })
);

app.post(
  "/internal/runtime/sync",
  asyncRoute(async (request, response) => {
    if (!isRuntimeSyncAuthorized(request)) {
      response.status(401).json({ error: "Unauthorized runtime sync request." });
      return;
    }

    const payload = normalizeRuntimeSyncBody(request.body);
    if (payload.projectId !== runtimeConfig.projectId) {
      response.status(409).json({
        error: "projectId mismatch for runtime sync.",
        expectedProjectId: runtimeConfig.projectId,
        receivedProjectId: payload.projectId
      });
      return;
    }

    const current = await getRuntimeState(runtimeConfig);
    if (payload.version < current.version) {
      response.json({
        ok: true,
        ignored: true,
        currentVersion: current.version
      });
      return;
    }

    const next = await saveRuntimeState(runtimeConfig, {
      version: payload.version,
      config: payload.config,
      secrets: payload.secrets
    });

    response.json({
      ok: true,
      appliedVersion: next.version,
      ignored: false
    });
  })
);

app.get(
  "/api/catalog",
  asyncRoute(async (_request, response) => {
    const payload = await catalogAdapter.getCatalog();
    response.json(payload);
  })
);

app.get(
  "/api/products/:handle",
  asyncRoute(async (request, response) => {
    const handle = request.params.handle?.trim();
    if (!handle) {
      response.status(400).json({ error: "Product handle is required." });
      return;
    }

    const payload = await catalogAdapter.getProductByHandle(handle);
    if (payload && typeof payload === "object" && typeof payload.error === "string") {
      response.status(404).json(payload);
      return;
    }

    response.json(payload);
  })
);

app.get(
  "/api/customer-auth/config",
  asyncRoute(async (_request, response) => {
    const auth = await customerAuthAdapter.getConfig();
    response.json({ auth });
  })
);

app.post(
  "/api/customer-auth/method",
  asyncRoute(async (request, response) => {
    const activeMethod = typeof request.body?.activeMethod === "string" ? request.body.activeMethod : "";
    if (activeMethod !== "shopify_hosted" && activeMethod !== "customer_account_api") {
      response.status(400).json({ error: "activeMethod must be shopify_hosted or customer_account_api." });
      return;
    }

    const payload = await customerAuthAdapter.setMethod(activeMethod);
    response.json(payload ?? { ok: true });
  })
);

app.post(
  "/api/customer-auth/start",
  asyncRoute(async (_request, response) => {
    const payload = await customerAuthAdapter.start();
    response.json(payload);
  })
);

app.get(
  "/api/customer-auth/session/:sessionId",
  asyncRoute(async (request, response) => {
    const sessionId = request.params.sessionId?.trim();
    if (!sessionId) {
      response.status(400).json({ error: "sessionId is required." });
      return;
    }

    const payload = await customerAuthAdapter.getSession(sessionId);
    response.json(payload);
  })
);

app.post(
  "/api/customer-auth/refresh",
  asyncRoute(async (request, response) => {
    const refreshToken = typeof request.body?.refreshToken === "string" ? request.body.refreshToken.trim() : "";
    if (!refreshToken) {
      response.status(400).json({ error: "refreshToken is required." });
      return;
    }

    const payload = await customerAuthAdapter.refresh(refreshToken);
    response.json(payload);
  })
);

const server = app.listen(runtimeConfig.port, () => {
  console.log("Expo backend listening on port", runtimeConfig.port);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
`;
}

function getRequiredBaselineFiles(input: ShopifyBaselineInput): string[] {
  const mobileAppDir = normalizeWorkspaceDir(input.mobileAppDir, "mobile");
  const expoBackendDir = resolveExpoBackendDir(input);

  return [
    toWorkspacePath(mobileAppDir, "app/_layout.tsx"),
    toWorkspacePath(mobileAppDir, "app/(tabs)/index.tsx"),
    toWorkspacePath(mobileAppDir, "app/(tabs)/search.tsx"),
    toWorkspacePath(mobileAppDir, "app/(tabs)/cart.tsx"),
    toWorkspacePath(mobileAppDir, "app/(tabs)/account.tsx"),
    toWorkspacePath(mobileAppDir, "app/product/[handle].tsx"),
    toWorkspacePath(mobileAppDir, "src/features/shopify/api.ts"),
    toWorkspacePath(mobileAppDir, "src/features/shopify/shopify-provider.tsx"),
    toWorkspacePath(mobileAppDir, "src/features/cart/cart-context.tsx"),
    toWorkspacePath(mobileAppDir, "src/features/auth/auth-provider.tsx"),
    toWorkspacePath(mobileAppDir, "src/features/auth/auth-config.ts"),
    toWorkspacePath(mobileAppDir, "src/features/auth/types.ts"),
    toWorkspacePath(mobileAppDir, "src/features/auth/strategies/base.ts"),
    toWorkspacePath(mobileAppDir, "src/features/auth/strategies/shopify-hosted.ts"),
    toWorkspacePath(mobileAppDir, "src/features/auth/strategies/customer-account-api.ts"),
    toWorkspacePath(expoBackendDir, "package.json"),
    toWorkspacePath(expoBackendDir, "src/index.js"),
    toWorkspacePath(expoBackendDir, "src/config.js"),
    toWorkspacePath(expoBackendDir, "src/lib/runtime-state-store.js"),
    toWorkspacePath(expoBackendDir, "src/lib/shopify-admin-client.js"),
    toWorkspacePath(expoBackendDir, "src/adapters/catalog-adapter.js"),
    toWorkspacePath(expoBackendDir, "src/adapters/customer-auth-adapter.js")
  ];
}

const FORBIDDEN_PATTERNS = [
  "replace(//$/",
  "undefined (reading 'body')"
];

export function validateShopifyBaselineFiles(files: Record<string, string>, input: ShopifyBaselineInput): void {
  for (const requiredPath of getRequiredBaselineFiles(input)) {
    if (typeof files[requiredPath] !== "string" || files[requiredPath].trim().length === 0) {
      throw new Error(`Shopify baseline validation failed: missing required file ${requiredPath}`);
    }
  }

  for (const [filePath, content] of Object.entries(files)) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (content.includes(pattern)) {
        throw new Error(`Shopify baseline validation failed: forbidden pattern \"${pattern}\" found in ${filePath}`);
      }
    }
  }
}

function renderCatalogHook(): string {
  return `import { useCallback, useEffect, useState } from "react";
import { useShopify } from "./shopify-provider";
import { ProductSummary } from "./types";

export function useShopifyCatalog() {
  const { fetchCatalog } = useShopify();
  const [data, setData] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchCatalog();
      setData(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to fetch catalog");
    } finally {
      setLoading(false);
    }
  }, [fetchCatalog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
`;
}

function renderShopifyProvider(): string {
  return `import { createContext, useCallback, useContext, useMemo } from "react";
import { fetchCatalog as fetchCatalogApi, fetchProductByHandle as fetchProductByHandleApi } from "./api";
import { storeConfig } from "./store-config";
import { ProductDetail, ProductSummary } from "./types";

interface ShopifyContextValue {
  shopDomain: string;
  brandColor: string;
  fetchCatalog: () => Promise<ProductSummary[]>;
  fetchProductByHandle: (handle: string) => Promise<ProductDetail>;
}

const ShopifyContext = createContext<ShopifyContextValue | null>(null);

export function ShopifyProvider({ children }: { children: React.ReactNode }) {
  const fetchCatalog = useCallback(async () => {
    return fetchCatalogApi();
  }, []);

  const fetchProductByHandle = useCallback(async (handle: string) => {
    return fetchProductByHandleApi(handle);
  }, []);

  const value = useMemo<ShopifyContextValue>(
    () => ({
      shopDomain: storeConfig.shopDomain,
      brandColor: storeConfig.brandColor,
      fetchCatalog,
      fetchProductByHandle
    }),
    [fetchCatalog, fetchProductByHandle]
  );

  return <ShopifyContext.Provider value={value}>{children}</ShopifyContext.Provider>;
}

export function useShopify(): ShopifyContextValue {
  const context = useContext(ShopifyContext);
  if (!context) {
    throw new Error("useShopify must be used inside ShopifyProvider");
  }

  return context;
}
`;
}

function renderAuthTypes(): string {
  return `export type AuthMethod = "shopify_hosted" | "customer_account_api";

export type AuthStatus =
  | "idle"
  | "loading_config"
  | "signed_out"
  | "signing_in"
  | "awaiting_completion"
  | "signed_in"
  | "error";

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
}

export interface AuthSession {
  method: AuthMethod;
  tokens?: AuthTokens;
  signedInAt?: string;
}

export interface CustomerAuthRemoteConfig {
  activeMethod: AuthMethod;
  recommendedMethod: AuthMethod;
  supportedMethods: AuthMethod[];
  hosted: {
    accountsEnabled: boolean;
    accountType: "new" | "legacy" | "disabled" | "unknown";
    loginUrl: string;
    accountUrl: string;
  };
  customerAccountApi: {
    enabled: boolean;
    hasClientId: boolean;
    scopes: string[];
    issuer?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
  };
  endpoints: {
    start: string;
    sessionBase: string;
    refresh: string;
  };
}

export interface CustomerAuthConfigResponse {
  auth: CustomerAuthRemoteConfig;
}
`;
}

function renderAuthConfig(): string {
  return `import { storeConfig } from "../shopify/store-config";
import { AuthMethod, CustomerAuthConfigResponse, CustomerAuthRemoteConfig } from "./types";

const API_BASE = storeConfig.expoBackendBaseUrl.replace(/\\/$/, "");

if (!API_BASE) {
  throw new Error("Missing EXPO_PUBLIC_RUNTIME_BACKEND_URL. Start the dev session from SaaS so runner injects the Expo backend URL.");
}

function absolute(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return API_BASE + path;
}

export async function fetchCustomerAuthConfig(): Promise<CustomerAuthRemoteConfig> {
  const response = await fetch(absolute("/api/customer-auth/config"), {
    method: "GET"
  });

  const payload = (await response.json().catch(() => null)) as
    | CustomerAuthConfigResponse
    | { error?: string }
    | null;

  if (!response.ok || !payload || !("auth" in payload)) {
    throw new Error((payload && "error" in payload && payload.error) || "Failed to load customer auth config");
  }

  return payload.auth;
}

export async function updateActiveAuthMethod(method: AuthMethod): Promise<void> {
  const response = await fetch(absolute("/api/customer-auth/method"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      activeMethod: method
    })
  });

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to update active auth method");
  }
}

export function resolveAuthUrl(path: string): string {
  return absolute(path);
}
`;
}

function renderAuthStrategyBase(): string {
  return `import { AuthSession, AuthStatus, CustomerAuthRemoteConfig } from "../types";

export interface AuthStrategyContext {
  config: CustomerAuthRemoteConfig;
  setStatus: (status: AuthStatus) => void;
  setError: (message: string | null) => void;
  setSession: (session: AuthSession | undefined) => void;
  setPendingSessionId: (sessionId: string | undefined) => void;
  setLastPolledSessionId: (sessionId: string | undefined) => void;
  setLastCompletedSessionId: (sessionId: string | undefined) => void;
}

export interface AuthStrategy {
  signIn: () => Promise<void>;
  completeSignIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}
`;
}

function renderHostedAuthStrategy(): string {
  return `import { Linking } from "react-native";
import { AuthStrategy, AuthStrategyContext } from "./base";

export function createHostedAuthStrategy(context: AuthStrategyContext): AuthStrategy {
  return {
    signIn: async () => {
      context.setStatus("signing_in");
      context.setError(null);
      context.setPendingSessionId(undefined);
      await Linking.openURL(context.config.hosted.loginUrl);
      context.setStatus("signed_out");
    },
    completeSignIn: async () => {
      return false;
    },
    signOut: async () => {
      context.setPendingSessionId(undefined);
      context.setSession(undefined);
      context.setStatus("signed_out");
      context.setError(null);
    }
  };
}
`;
}

function renderCustomerApiAuthStrategy(): string {
  return `import { Linking } from "react-native";
import { AuthSession } from "../types";
import { resolveAuthUrl } from "../auth-config";
import { AuthStrategy, AuthStrategyContext } from "./base";

let pendingSessionId: string | undefined;

interface StartPayload {
  sessionId?: string;
  authUrl?: string;
  error?: string;
}

interface SessionStatusPayload {
  status?: "pending" | "completed" | "failed" | "expired" | "consumed";
  tokens?: AuthSession["tokens"];
  error?: string;
  requestedSessionId?: string;
  knownSessionIds?: string[];
}

export function createCustomerApiAuthStrategy(context: AuthStrategyContext): AuthStrategy {
  return {
    signIn: async () => {
      context.setStatus("signing_in");
      context.setError(null);

      const startResponse = await fetch(resolveAuthUrl(context.config.endpoints.start), {
        method: "POST"
      });
      const startPayload = (await startResponse.json().catch(() => null)) as StartPayload | null;
      if (!startResponse.ok || !startPayload?.sessionId || !startPayload.authUrl) {
        context.setStatus("error");
        throw new Error(startPayload?.error ?? "Failed to start customer auth");
      }

      pendingSessionId = startPayload.sessionId;
      context.setPendingSessionId(pendingSessionId);
      context.setStatus("awaiting_completion");
      await Linking.openURL(startPayload.authUrl);
    },
    completeSignIn: async () => {
      if (!pendingSessionId) {
        return false;
      }

      context.setLastPolledSessionId(pendingSessionId);

      const response = await fetch(
        resolveAuthUrl(context.config.endpoints.sessionBase + "/" + encodeURIComponent(pendingSessionId)),
        {
          method: "GET"
        }
      );

      const payload = (await response.json().catch(() => null)) as SessionStatusPayload | null;
      if (!response.ok || !payload?.status) {
        context.setStatus("error");
        const sessionDebug = payload?.knownSessionIds?.length
          ? " Known session IDs: " + payload.knownSessionIds.join(", ")
          : "";
        const requestedDebug = payload?.requestedSessionId
          ? " Requested: " + payload.requestedSessionId + "."
          : "";
        context.setError((payload?.error ?? "Failed to check auth status") + requestedDebug + sessionDebug);
        return false;
      }

      if (payload.status === "pending") {
        context.setStatus("awaiting_completion");
        return false;
      }

      if (payload.status === "completed" && payload.tokens?.accessToken) {
        context.setSession({
          method: "customer_account_api",
          tokens: payload.tokens,
          signedInAt: new Date().toISOString()
        });
        context.setStatus("signed_in");
        context.setError(null);
        context.setLastCompletedSessionId(pendingSessionId);
        pendingSessionId = undefined;
        context.setPendingSessionId(undefined);
        return true;
      }

      context.setStatus("error");
      context.setError(payload.error ?? "Customer auth did not complete");
      if (payload.status !== "pending") {
        pendingSessionId = undefined;
        context.setPendingSessionId(undefined);
      }
      return false;
    },
    signOut: async () => {
      pendingSessionId = undefined;
      context.setPendingSessionId(undefined);
      context.setSession(undefined);
      context.setStatus("signed_out");
      context.setError(null);
    }
  };
}
`;
}

function renderAuthProvider(): string {
  return `import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { fetchCustomerAuthConfig, updateActiveAuthMethod } from "./auth-config";
import { createCustomerApiAuthStrategy } from "./strategies/customer-account-api";
import { createHostedAuthStrategy } from "./strategies/shopify-hosted";
import { AuthMethod, AuthSession, AuthStatus, CustomerAuthRemoteConfig } from "./types";

interface AuthContextValue {
  status: AuthStatus;
  session?: AuthSession;
  config: CustomerAuthRemoteConfig;
  error: string | null;
  activeMethod: AuthMethod;
  pendingSessionId?: string;
  lastPolledSessionId?: string;
  lastCompletedSessionId?: string;
  isLoading: boolean;
  setActiveMethod: (method: AuthMethod) => void;
  signIn: () => Promise<void>;
  completeSignIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const FALLBACK_CONFIG: CustomerAuthRemoteConfig = {
  activeMethod: "shopify_hosted",
  recommendedMethod: "shopify_hosted",
  supportedMethods: ["shopify_hosted"],
  hosted: {
    accountsEnabled: true,
    accountType: "unknown",
    loginUrl: "",
    accountUrl: ""
  },
  customerAccountApi: {
    enabled: false,
    hasClientId: false,
    scopes: []
  },
  endpoints: {
    start: "",
    sessionBase: "",
    refresh: ""
  }
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading_config");
  const [config, setConfig] = useState<CustomerAuthRemoteConfig>(FALLBACK_CONFIG);
  const [session, setSession] = useState<AuthSession | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [activeMethod, setActiveMethodState] = useState<AuthMethod>("shopify_hosted");
  const [pendingSessionId, setPendingSessionId] = useState<string | undefined>();
  const [lastPolledSessionId, setLastPolledSessionId] = useState<string | undefined>();
  const [lastCompletedSessionId, setLastCompletedSessionId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const remote = await fetchCustomerAuthConfig();
        if (cancelled) return;

        setConfig(remote);
        setActiveMethodState(remote.activeMethod);
        setStatus("signed_out");
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Failed to load auth config");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const strategyContext = useMemo(
    () => ({
      config,
      setStatus,
      setError,
      setSession,
      setPendingSessionId,
      setLastPolledSessionId,
      setLastCompletedSessionId
    }),
    [config]
  );

  const strategy = useMemo(() => {
    if (activeMethod === "customer_account_api") {
      return createCustomerApiAuthStrategy(strategyContext);
    }

    return createHostedAuthStrategy(strategyContext);
  }, [activeMethod, strategyContext]);

  const setActiveMethod = useCallback(
    (method: AuthMethod) => {
      if (!config.supportedMethods.includes(method)) {
        return;
      }

      setActiveMethodState(method);
      setStatus("signed_out");
      setSession(undefined);
      setError(null);
      setPendingSessionId(undefined);
      void updateActiveAuthMethod(method).catch(() => {
        // local method remains selected even if backend persistence fails
      });
    },
    [config.supportedMethods]
  );

  const signIn = useCallback(async () => {
    try {
      await strategy.signIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed");
      setStatus("error");
    }
  }, [strategy]);

  const completeSignIn = useCallback(async () => {
    try {
      return await strategy.completeSignIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in completion failed");
      setStatus("error");
      return false;
    }
  }, [strategy]);

  const signOut = useCallback(async () => {
    try {
      await strategy.signOut();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-out failed");
      setStatus("error");
    }
  }, [strategy]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && status === "awaiting_completion") {
        void completeSignIn();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [completeSignIn, status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      config,
      error,
      activeMethod,
      pendingSessionId,
      lastPolledSessionId,
      lastCompletedSessionId,
      isLoading: status === "loading_config" || status === "signing_in",
      setActiveMethod,
      signIn,
      completeSignIn,
      signOut
    }),
    [
      status,
      session,
      config,
      error,
      activeMethod,
      pendingSessionId,
      lastPolledSessionId,
      lastCompletedSessionId,
      setActiveMethod,
      signIn,
      completeSignIn,
      signOut
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
`;
}

function renderCartContext(): string {
  return `import { createContext, useContext, useMemo, useState } from "react";
import { useShopify } from "../shopify/shopify-provider";

interface CartLine {
  variantId: string;
  title: string;
  price: number;
  quantity: number;
}

interface CartContextValue {
  lines: CartLine[];
  subtotal: number;
  checkoutUrl: string | null;
  addLine: (line: CartLine) => void;
  increment: (variantId: string) => void;
  decrement: (variantId: string) => void;
  removeLine: (variantId: string) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const { shopDomain } = useShopify();

  const value = useMemo<CartContextValue>(() => {
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const checkoutPath = lines
      .map((line) => line.variantId + ":" + line.quantity)
      .join(",");

    const checkoutUrl = checkoutPath ? "https://" + shopDomain + "/cart/" + checkoutPath : null;

    return {
      lines,
      subtotal,
      checkoutUrl,
      addLine: (line) => {
        setLines((current) => {
          const existing = current.find((item) => item.variantId === line.variantId);
          if (!existing) {
            return [...current, line];
          }

          return current.map((item) =>
            item.variantId === line.variantId
              ? { ...item, quantity: item.quantity + line.quantity }
              : item
          );
        });
      },
      increment: (variantId) => {
        setLines((current) =>
          current.map((item) =>
            item.variantId === variantId ? { ...item, quantity: item.quantity + 1 } : item
          )
        );
      },
      decrement: (variantId) => {
        setLines((current) =>
          current
            .map((item) =>
              item.variantId === variantId ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item
            )
            .filter((item) => item.quantity > 0)
        );
      },
      removeLine: (variantId) => {
        setLines((current) => current.filter((item) => item.variantId !== variantId));
      }
    };
  }, [lines, shopDomain]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside CartProvider");
  }

  return context;
}
`;
}

export function renderShopifyBaselineFiles(input: ShopifyBaselineInput): Record<string, string> {
  const mobileAppDir = normalizeWorkspaceDir(input.mobileAppDir, "mobile");
  const expoBackendDir = resolveExpoBackendDir(input);

  return {
    [toWorkspacePath(mobileAppDir, "app/_layout.tsx")]: renderAppLayout(),
    [toWorkspacePath(mobileAppDir, "app/(tabs)/_layout.tsx")]: renderTabsLayout(),
    [toWorkspacePath(mobileAppDir, "app/(tabs)/index.tsx")]: renderHomeScreen(),
    [toWorkspacePath(mobileAppDir, "app/(tabs)/search.tsx")]: renderSearchScreen(),
    [toWorkspacePath(mobileAppDir, "app/(tabs)/cart.tsx")]: renderCartScreen(),
    [toWorkspacePath(mobileAppDir, "app/(tabs)/account.tsx")]: renderAccountScreen(),
    [toWorkspacePath(mobileAppDir, "app/product/[handle].tsx")]: renderProductScreen(),
    [toWorkspacePath(mobileAppDir, "src/features/shopify/store-config.ts")]: renderStoreConfig({
      ...input,
      projectName: escapeTemplateLiteral(input.projectName)
    }),
    [toWorkspacePath(mobileAppDir, "src/features/shopify/types.ts")]: renderShopifyTypes(),
    [toWorkspacePath(mobileAppDir, "src/features/shopify/api.ts")]: renderShopifyApi(),
    [toWorkspacePath(mobileAppDir, "src/features/shopify/shopify-provider.tsx")]: renderShopifyProvider(),
    [toWorkspacePath(mobileAppDir, "src/features/shopify/use-shopify-catalog.ts")]: renderCatalogHook(),
    [toWorkspacePath(mobileAppDir, "src/features/auth/types.ts")]: renderAuthTypes(),
    [toWorkspacePath(mobileAppDir, "src/features/auth/auth-config.ts")]: renderAuthConfig(),
    [toWorkspacePath(mobileAppDir, "src/features/auth/strategies/base.ts")]: renderAuthStrategyBase(),
    [toWorkspacePath(mobileAppDir, "src/features/auth/strategies/shopify-hosted.ts")]: renderHostedAuthStrategy(),
    [toWorkspacePath(mobileAppDir, "src/features/auth/strategies/customer-account-api.ts")]: renderCustomerApiAuthStrategy(),
    [toWorkspacePath(mobileAppDir, "src/features/auth/auth-provider.tsx")]: renderAuthProvider(),
    [toWorkspacePath(mobileAppDir, "src/features/cart/cart-context.tsx")]: renderCartContext(),
    [toWorkspacePath(expoBackendDir, "package.json")]: renderRuntimeBackendPackageJson(),
    [toWorkspacePath(expoBackendDir, ".gitignore")]: renderRuntimeBackendGitIgnore(),
    [toWorkspacePath(expoBackendDir, ".env.example")]: renderRuntimeBackendEnvExample(input),
    [toWorkspacePath(expoBackendDir, "README.md")]: renderRuntimeBackendReadme(input),
    [toWorkspacePath(expoBackendDir, "src/config.js")]: renderRuntimeBackendConfig(input),
    [toWorkspacePath(expoBackendDir, "src/index.js")]: renderRuntimeBackendServer(),
    [toWorkspacePath(expoBackendDir, "src/lib/runtime-state-store.js")]: renderRuntimeBackendRuntimeStateStore(),
    [toWorkspacePath(expoBackendDir, "src/lib/shopify-admin-client.js")]: renderRuntimeBackendShopifyAdminClient(),
    [toWorkspacePath(expoBackendDir, "src/adapters/catalog-adapter.js")]: renderRuntimeBackendCatalogAdapter(),
    [toWorkspacePath(expoBackendDir, "src/adapters/customer-auth-adapter.js")]: renderRuntimeBackendCustomerAuthAdapter(),
    ".shopify-baseline.json": JSON.stringify(
      {
        version: 3,
        appliedAt: new Date().toISOString(),
        shopDomain: input.shopDomain,
        mobileAppDir,
        expoBackendDir,
        expoBackendPort: resolveExpoBackendPort(input)
      },
      null,
      2
    )
  };
}
