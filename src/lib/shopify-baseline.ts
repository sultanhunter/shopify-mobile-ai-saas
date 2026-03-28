interface ShopifyBaselineInput {
  projectId: string;
  projectName: string;
  shopDomain: string;
  controlPlaneBaseUrl: string;
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
    isLoading
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
  controlPlaneBaseUrl: ${JSON.stringify(input.controlPlaneBaseUrl)},
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
        express: "^4.19.2"
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
CONTROL_PLANE_BASE_URL=${input.controlPlaneBaseUrl}
API_TIMEOUT_MS=15000

# Optional shared secret to call control-plane APIs
BACKEND_AUTH_TOKEN=
`;
}

function renderRuntimeBackendReadme(input: ShopifyBaselineInput): string {
  return `# Expo Backend

This backend powers the generated Expo storefront app for project \`${input.projectId}\`.

## What this service does

- Exposes mobile-friendly API endpoints for catalog and customer auth
- Keeps backend logic in the workspace instead of the SaaS frontend server
- Uses adapter modules so auth implementations can be swapped later

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
`;
}

function renderRuntimeBackendConfig(input: ShopifyBaselineInput): string {
  return `import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PROJECT_ID = ${JSON.stringify(input.projectId)};
const DEFAULT_CONTROL_PLANE_BASE_URL = ${JSON.stringify(input.controlPlaneBaseUrl)};
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
  controlPlaneBaseUrl: asString(process.env.CONTROL_PLANE_BASE_URL, DEFAULT_CONTROL_PLANE_BASE_URL).replace(/\\/$/, ""),
  timeoutMs: asNumber(process.env.API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  backendAuthToken: process.env.BACKEND_AUTH_TOKEN?.trim() || undefined
};

if (!runtimeConfig.projectId) {
  throw new Error("PROJECT_ID is required for expo backend.");
}

if (!runtimeConfig.controlPlaneBaseUrl || !/^https?:\\/\\//.test(runtimeConfig.controlPlaneBaseUrl)) {
  throw new Error("CONTROL_PLANE_BASE_URL must be a valid http(s) URL.");
}
`;
}

function renderRuntimeBackendHttpClient(): string {
  return `export async function requestJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : "Request failed with status " + response.status;
      throw new Error(typeof message === "string" ? message : "Request failed");
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out after " + Math.round(timeoutMs / 1000) + "s");
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}
`;
}

function renderRuntimeBackendControlPlaneClient(): string {
  return `import { requestJson } from "./http-client.js";

export function createControlPlaneClient(config) {
  const base = config.controlPlaneBaseUrl.replace(/\\/$/, "");

  function request(path, options = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {})
    };

    if (config.backendAuthToken) {
      headers.Authorization = "Bearer " + config.backendAuthToken;
    }

    return requestJson(base + path, {
      ...options,
      headers,
      timeoutMs: config.timeoutMs
    });
  }

  const projectPath = "/api/projects/" + encodeURIComponent(config.projectId);

  return {
    fetchCatalog: () => request(projectPath + "/shopify/catalog", { method: "GET" }),
    fetchProductByHandle: (handle) =>
      request(projectPath + "/shopify/products/" + encodeURIComponent(handle), { method: "GET" }),
    fetchCustomerAuthConfig: () => request(projectPath + "/shopify/customer-auth/config", { method: "GET" }),
    setActiveCustomerAuthMethod: (activeMethod) =>
      request(projectPath + "/shopify/customer-auth/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeMethod })
      }),
    startCustomerAuth: () => request(projectPath + "/shopify/customer-auth/start", { method: "POST" }),
    fetchCustomerAuthSession: (sessionId) =>
      request(projectPath + "/shopify/customer-auth/session/" + encodeURIComponent(sessionId), { method: "GET" }),
    refreshCustomerAuth: (refreshToken) =>
      request(projectPath + "/shopify/customer-auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      })
  };
}
`;
}

function renderRuntimeBackendCatalogAdapter(): string {
  return `export function createCatalogAdapter(controlPlaneClient) {
  return {
    async getCatalog() {
      const payload = await controlPlaneClient.fetchCatalog();
      return {
        shopDomain: typeof payload?.shopDomain === "string" ? payload.shopDomain : undefined,
        products: Array.isArray(payload?.products) ? payload.products : []
      };
    },
    async getProductByHandle(handle) {
      return controlPlaneClient.fetchProductByHandle(handle);
    }
  };
}
`;
}

function renderRuntimeBackendCustomerAuthAdapter(): string {
  return `function normalizeConfig(payload) {
  const auth = payload && typeof payload === "object" && "auth" in payload ? payload.auth : null;
  if (!auth || typeof auth !== "object") {
    throw new Error("Invalid customer auth payload from control plane.");
  }

  return {
    ...auth,
    endpoints: {
      start: "/api/customer-auth/start",
      sessionBase: "/api/customer-auth/session",
      refresh: "/api/customer-auth/refresh"
    }
  };
}

export function createCustomerAuthAdapter(controlPlaneClient) {
  return {
    async getConfig() {
      const payload = await controlPlaneClient.fetchCustomerAuthConfig();
      return normalizeConfig(payload);
    },
    async setMethod(activeMethod) {
      return controlPlaneClient.setActiveCustomerAuthMethod(activeMethod);
    },
    async start() {
      return controlPlaneClient.startCustomerAuth();
    },
    async getSession(sessionId) {
      return controlPlaneClient.fetchCustomerAuthSession(sessionId);
    },
    async refresh(refreshToken) {
      return controlPlaneClient.refreshCustomerAuth(refreshToken);
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
import { createControlPlaneClient } from "./lib/control-plane-client.js";

const app = express();

app.use(
  cors({
    origin: true,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

const controlPlaneClient = createControlPlaneClient(runtimeConfig);
const catalogAdapter = createCatalogAdapter(controlPlaneClient);
const customerAuthAdapter = createCustomerAuthAdapter(controlPlaneClient);

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

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    projectId: runtimeConfig.projectId,
    controlPlaneBaseUrl: runtimeConfig.controlPlaneBaseUrl
  });
});

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
    toWorkspacePath(expoBackendDir, "src/lib/control-plane-client.js"),
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
      await Linking.openURL(context.config.hosted.loginUrl);
      context.setStatus("signed_out");
    },
    completeSignIn: async () => {
      return false;
    },
    signOut: async () => {
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
      context.setStatus("awaiting_completion");
      await Linking.openURL(startPayload.authUrl);
    },
    completeSignIn: async () => {
      if (!pendingSessionId) {
        return false;
      }

      const response = await fetch(
        resolveAuthUrl(context.config.endpoints.sessionBase + "/" + encodeURIComponent(pendingSessionId)),
        {
          method: "GET"
        }
      );

      const payload = (await response.json().catch(() => null)) as SessionStatusPayload | null;
      if (!response.ok || !payload?.status) {
        context.setStatus("error");
        context.setError(payload?.error ?? "Failed to check auth status");
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
        pendingSessionId = undefined;
        return true;
      }

      context.setStatus("error");
      context.setError(payload.error ?? "Customer auth did not complete");
      if (payload.status !== "pending") {
        pendingSessionId = undefined;
      }
      return false;
    },
    signOut: async () => {
      pendingSessionId = undefined;
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
      setSession
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
      isLoading: status === "loading_config" || status === "signing_in",
      setActiveMethod,
      signIn,
      completeSignIn,
      signOut
    }),
    [status, session, config, error, activeMethod, setActiveMethod, signIn, completeSignIn, signOut]
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
    [toWorkspacePath(expoBackendDir, "src/lib/http-client.js")]: renderRuntimeBackendHttpClient(),
    [toWorkspacePath(expoBackendDir, "src/lib/control-plane-client.js")]: renderRuntimeBackendControlPlaneClient(),
    [toWorkspacePath(expoBackendDir, "src/adapters/catalog-adapter.js")]: renderRuntimeBackendCatalogAdapter(),
    [toWorkspacePath(expoBackendDir, "src/adapters/customer-auth-adapter.js")]: renderRuntimeBackendCustomerAuthAdapter(),
    ".shopify-baseline.json": JSON.stringify(
      {
        version: 2,
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
