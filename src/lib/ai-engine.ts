import { OpencodeSessionState, PreviewModel, PreviewScreen, Project } from "@/lib/models";

interface AiOutput {
  preview: PreviewModel;
  summary: string;
  files?: Record<string, string>;
  changedFiles?: string[];
  opencodeSession?: OpencodeSessionState;
}

const SCREEN_LIBRARY: Array<{
  id: string;
  title: string;
  triggers: string[];
  description: string;
  blocks: string[];
}> = [
  {
    id: "home",
    title: "Home",
    triggers: ["home", "landing", "hero"],
    description: "Merchandising home screen with Shopify-powered sections.",
    blocks: ["Hero", "Featured products", "Collections"]
  },
  {
    id: "products",
    title: "Products",
    triggers: ["products", "catalog", "listing", "grid"],
    description: "Browse products from Shopify with filters and sorting.",
    blocks: ["Search", "Filters", "Product grid"]
  },
  {
    id: "cart",
    title: "Cart",
    triggers: ["cart", "basket"],
    description: "Review selected products and move to checkout.",
    blocks: ["Cart items", "Promo code", "Checkout CTA"]
  },
  {
    id: "collections",
    title: "Collections",
    triggers: ["collection", "collections", "category", "categories"],
    description: "Explore curated Shopify collections.",
    blocks: ["Collection hero", "Collection chips", "Collection cards"]
  },
  {
    id: "search",
    title: "Search",
    triggers: ["search", "discover"],
    description: "Search products with quick suggestions.",
    blocks: ["Search bar", "Recent queries", "Result list"]
  },
  {
    id: "profile",
    title: "Profile",
    triggers: ["profile", "account", "user"],
    description: "Customer profile and account details.",
    blocks: ["Account summary", "Addresses", "Order history"]
  },
  {
    id: "orders",
    title: "Orders",
    triggers: ["orders", "order tracking", "tracking"],
    description: "Track fulfillment and order timeline.",
    blocks: ["Order timeline", "Shipment status", "Support CTA"]
  },
  {
    id: "wishlist",
    title: "Wishlist",
    triggers: ["wishlist", "favorites", "saved"],
    description: "Saved products ready to purchase later.",
    blocks: ["Saved items", "Price alerts", "Move to cart"]
  }
];

function uniqueScreens(screens: PreviewScreen[]): PreviewScreen[] {
  const seen = new Set<string>();
  const output: PreviewScreen[] = [];

  for (const screen of screens) {
    if (seen.has(screen.id)) {
      continue;
    }

    seen.add(screen.id);
    output.push(screen);
  }

  return output;
}

function maybeExtractPrimaryColor(prompt: string): string | null {
  const hexMatch = prompt.match(/#[0-9a-fA-F]{6}/);
  return hexMatch ? hexMatch[0] : null;
}

function appendBlockIfMentioned(screen: PreviewScreen, prompt: string, keyword: string, blockName: string) {
  if (prompt.includes(keyword) && !screen.blocks.includes(blockName)) {
    screen.blocks.push(blockName);
  }
}

export function applyRuleBasedPromptToProject(project: Project, prompt: string): AiOutput {
  const normalizedPrompt = prompt.toLowerCase();
  const preview: PreviewModel = JSON.parse(JSON.stringify(project.preview));
  const addedScreens: string[] = [];

  for (const catalogScreen of SCREEN_LIBRARY) {
    const shouldInclude = catalogScreen.triggers.some((trigger) => normalizedPrompt.includes(trigger));
    const exists = preview.screens.some((screen) => screen.id === catalogScreen.id);

    if (shouldInclude && !exists) {
      preview.screens.push({
        id: catalogScreen.id,
        title: catalogScreen.title,
        description: catalogScreen.description,
        blocks: [...catalogScreen.blocks]
      });
      addedScreens.push(catalogScreen.title);
    }
  }

  const cartScreen = preview.screens.find((screen) => screen.id === "cart");
  const homeScreen = preview.screens.find((screen) => screen.id === "home");
  const productsScreen = preview.screens.find((screen) => screen.id === "products");

  if (cartScreen) {
    appendBlockIfMentioned(cartScreen, normalizedPrompt, "one page checkout", "One-page checkout");
    appendBlockIfMentioned(cartScreen, normalizedPrompt, "subscription", "Subscription options");
  }

  if (homeScreen) {
    appendBlockIfMentioned(homeScreen, normalizedPrompt, "reviews", "Review carousel");
    appendBlockIfMentioned(homeScreen, normalizedPrompt, "loyalty", "Loyalty banner");
  }

  if (productsScreen) {
    appendBlockIfMentioned(productsScreen, normalizedPrompt, "sort", "Sorting controls");
    appendBlockIfMentioned(productsScreen, normalizedPrompt, "variant", "Variant selector");
  }

  const color = maybeExtractPrimaryColor(prompt);
  if (color) {
    preview.primaryColor = color;
  }

  if (normalizedPrompt.includes("dark mode") || normalizedPrompt.includes("dark theme")) {
    preview.theme = "dark";
  }

  if (normalizedPrompt.includes("light mode") || normalizedPrompt.includes("light theme")) {
    preview.theme = "light";
  }

  preview.screens = uniqueScreens(preview.screens);

  const summaryParts: string[] = [];
  if (addedScreens.length > 0) {
    summaryParts.push(`Added screens: ${addedScreens.join(", ")}`);
  }
  if (color) {
    summaryParts.push(`Updated primary color to ${color}`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push("Refined existing screens, layout blocks, and app structure.");
  }

  return {
    preview,
    summary: summaryParts.join(". ")
  };
}

export function applyPromptToProject(project: Project, prompt: string): AiOutput {
  return applyRuleBasedPromptToProject(project, prompt);
}

export type { AiOutput };
