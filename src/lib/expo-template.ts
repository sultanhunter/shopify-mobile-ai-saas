import { PreviewModel } from "@/lib/models";

interface RenderExpoFilesInput {
  projectName: string;
  projectId: string;
  preview: PreviewModel;
  storeDomain?: string;
  backendBaseUrl: string;
}

export function createInitialPreview(projectName: string): PreviewModel {
  return {
    appName: projectName,
    theme: "light",
    primaryColor: "#0f766e",
    screens: [
      {
        id: "home",
        title: "Home",
        description: "Merchandising home screen with Shopify-powered sections.",
        blocks: ["Hero", "Featured products", "Collections"]
      },
      {
        id: "products",
        title: "Products",
        description: "Browse products from Shopify with filters and sorting.",
        blocks: ["Search", "Filters", "Product grid"]
      },
      {
        id: "cart",
        title: "Cart",
        description: "Review selected products and move to checkout.",
        blocks: ["Cart items", "Promo code", "Checkout CTA"]
      }
    ]
  };
}

function formatScreenData(preview: PreviewModel) {
  return JSON.stringify(preview.screens, null, 2);
}

function renderLayoutTsx(): string {
  return `import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
`;
}

function renderAppIndexTsx(preview: PreviewModel): string {
  return `import React, { useMemo, useState } from "react";
import { SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appTheme, screens } from "../data/screens";
import { storeConfig } from "../config/store";

type Screen = (typeof screens)[number];

export default function HomeScreen() {
  const [activeScreenId, setActiveScreenId] = useState<string>(screens[0]?.id ?? "home");

  const activeScreen = useMemo<Screen>(() => {
    return screens.find((screen) => screen.id === activeScreenId) ?? screens[0];
  }, [activeScreenId]);

  return (
    <SafeAreaView style={[styles.safe, appTheme.theme === "dark" ? styles.dark : styles.light]}>
      <StatusBar barStyle={appTheme.theme === "dark" ? "light-content" : "dark-content"} />

      <View style={styles.header}>
        <Text style={[styles.appName, { color: appTheme.primaryColor }]}>{appTheme.appName}</Text>
        <Text style={styles.storeText}>{storeConfig.shopDomain || "Connect your Shopify store"}</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.screenTitle}>{activeScreen.title}</Text>
        <Text style={styles.screenDescription}>{activeScreen.description}</Text>

        <View style={styles.blockStack}>
          {activeScreen.blocks.map((block) => (
            <View key={block} style={styles.blockCard}>
              <Text style={styles.blockText}>{block}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.tabBar}>
        {screens.map((screen) => {
          const isActive = screen.id === activeScreenId;

          return (
            <TouchableOpacity
              key={screen.id}
              style={[styles.tabButton, isActive && { backgroundColor: appTheme.primaryColor }]}
              onPress={() => setActiveScreenId(screen.id)}
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{screen.title}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  dark: { backgroundColor: "#0f172a" },
  light: { backgroundColor: "#f8fafc" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1"
  },
  appName: { fontSize: 22, fontWeight: "700" },
  storeText: { marginTop: 4, color: "#475569", fontSize: 13 },
  content: { flex: 1 },
  contentContainer: { padding: 16, gap: 12 },
  screenTitle: { fontSize: 26, fontWeight: "700", color: "#0f172a" },
  screenDescription: { fontSize: 14, color: "#475569" },
  blockStack: { marginTop: 8, gap: 10 },
  blockCard: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: "#ffffff"
  },
  blockText: { fontSize: 14, color: "#0f172a", fontWeight: "500" },
  tabBar: {
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    padding: 12,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  tabButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#e2e8f0"
  },
  tabLabel: { color: "#1e293b", fontSize: 12, fontWeight: "600" },
  tabLabelActive: { color: "#ffffff" }
});
`;
}

function renderExploreTsx(): string {
  return `import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function ExploreScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Explore</Text>
        <Text style={styles.copy}>This screen is AI-managed and does not depend on local image assets.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  card: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 14,
    backgroundColor: "#ffffff",
    padding: 16,
    gap: 8
  },
  title: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  copy: { fontSize: 14, color: "#475569" }
});
`;
}

function renderScreensTs(preview: PreviewModel): string {
  return `export const appTheme = {
  appName: ${JSON.stringify(preview.appName)},
  theme: ${JSON.stringify(preview.theme)},
  primaryColor: ${JSON.stringify(preview.primaryColor)}
} as const;

export const screens = ${formatScreenData(preview)} as const;
`;
}

function renderStoreConfig(
  storeDomain: string | undefined,
  projectId: string,
  backendBaseUrl: string
): string {
  return `export const storeConfig = {
  projectId: ${JSON.stringify(projectId)},
  shopDomain: ${JSON.stringify(storeDomain ?? "")},
  backendBaseUrl: ${JSON.stringify(backendBaseUrl)}
} as const;
`;
}

export function renderExpoFiles(input: RenderExpoFilesInput): Record<string, string> {
  const slug = input.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const appSlug = slug.length > 0 ? slug : "shopify-mobile-app";

  return {
    "app.json": JSON.stringify(
      {
        expo: {
          name: input.projectName,
          slug: appSlug,
          version: "1.0.0",
          orientation: "portrait",
          userInterfaceStyle: "automatic",
          jsEngine: "hermes"
        }
      },
      null,
      2
    ),
    "src/app/_layout.tsx": renderLayoutTsx(),
    "src/app/index.tsx": renderAppIndexTsx(input.preview),
    "src/app/explore.tsx": renderExploreTsx(),
    "src/data/screens.ts": renderScreensTs(input.preview),
    "src/config/store.ts": renderStoreConfig(input.storeDomain, input.projectId, input.backendBaseUrl),
    "src/services/shopify.ts": `import { storeConfig } from "../config/store";

export async function fetchShopProducts() {
  const response = await fetch(
    \`\${storeConfig.backendBaseUrl}/api/projects/\${storeConfig.projectId}\`,
    {
      method: "GET"
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch app configuration from backend");
  }

  return response.json();
}
`,
    "README.generated.md": `# ${input.projectName} (Generated by Shopify Mobile AI Builder)

This Expo app was scaffolded with create-expo-app and augmented by Shopify Mobile AI Builder.

## Generated files

- src/app/index.tsx
- src/data/screens.ts
- src/config/store.ts
- src/services/shopify.ts
`
  };
}
