interface ShopifyBaselineInput {
  projectId: string;
  projectName: string;
  shopDomain: string;
  backendBaseUrl: string;
  brandColor: string;
}

function escapeTemplateLiteral(value: string): string {
  return value.replace(/`/g, "\\`");
}

function renderAppLayout(): string {
  return `import { Stack } from "expo-router";
import { CartProvider } from "../src/features/cart/cart-context";
import { ShopifyProvider } from "../src/features/shopify/shopify-provider";

export default function RootLayout() {
  return (
    <ShopifyProvider>
      <CartProvider>
        <Stack screenOptions={{ headerBackTitle: "Back" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="product/[handle]" options={{ title: "Product" }} />
        </Stack>
      </CartProvider>
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
  return `export const storeConfig = {
  projectId: ${JSON.stringify(input.projectId)},
  projectName: ${JSON.stringify(input.projectName)},
  shopDomain: ${JSON.stringify(input.shopDomain)},
  backendBaseUrl: ${JSON.stringify(input.backendBaseUrl)},
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
  const root = storeConfig.backendBaseUrl.replace(/\\/$/, "");
  return root + path;
}

export async function fetchCatalog(): Promise<ProductSummary[]> {
  const response = await fetch(apiUrl("/api/projects/" + storeConfig.projectId + "/shopify/catalog"));
  const payload = (await response.json().catch(() => null)) as
    | { products?: ProductSummary[]; error?: string }
    | null;

  if (!response.ok || !payload?.products) {
    throw new Error(payload?.error ?? "Failed to fetch Shopify catalog");
  }

  return payload.products;
}

export async function fetchProductByHandle(handle: string): Promise<ProductDetail> {
  const response = await fetch(
    apiUrl("/api/projects/" + storeConfig.projectId + "/shopify/products/" + encodeURIComponent(handle))
  );
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

const REQUIRED_BASELINE_FILES = [
  "app/_layout.tsx",
  "app/(tabs)/index.tsx",
  "app/(tabs)/search.tsx",
  "app/(tabs)/cart.tsx",
  "app/product/[handle].tsx",
  "src/features/shopify/api.ts",
  "src/features/shopify/shopify-provider.tsx",
  "src/features/cart/cart-context.tsx"
];

const FORBIDDEN_PATTERNS = [
  "replace(//$/",
  "undefined (reading 'body')"
];

export function validateShopifyBaselineFiles(files: Record<string, string>): void {
  for (const requiredPath of REQUIRED_BASELINE_FILES) {
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
  return {
    "app/_layout.tsx": renderAppLayout(),
    "app/(tabs)/_layout.tsx": renderTabsLayout(),
    "app/(tabs)/index.tsx": renderHomeScreen(),
    "app/(tabs)/search.tsx": renderSearchScreen(),
    "app/(tabs)/cart.tsx": renderCartScreen(),
    "app/product/[handle].tsx": renderProductScreen(),
    "src/features/shopify/store-config.ts": renderStoreConfig({
      ...input,
      projectName: escapeTemplateLiteral(input.projectName)
    }),
    "src/features/shopify/types.ts": renderShopifyTypes(),
    "src/features/shopify/api.ts": renderShopifyApi(),
    "src/features/shopify/shopify-provider.tsx": renderShopifyProvider(),
    "src/features/shopify/use-shopify-catalog.ts": renderCatalogHook(),
    "src/features/cart/cart-context.tsx": renderCartContext(),
    ".shopify-baseline.json": JSON.stringify(
      {
        version: 1,
        appliedAt: new Date().toISOString(),
        shopDomain: input.shopDomain
      },
      null,
      2
    )
  };
}
