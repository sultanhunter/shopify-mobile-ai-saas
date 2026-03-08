"use client";

import { useMemo, useState } from "react";
import { PreviewModel } from "@/lib/models";

interface MobilePreviewProps {
  preview: PreviewModel;
}

export function MobilePreview({ preview }: MobilePreviewProps) {
  const [activeScreenId, setActiveScreenId] = useState(preview.screens[0]?.id ?? "home");

  const activeScreen = useMemo(() => {
    return preview.screens.find((screen) => screen.id === activeScreenId) ?? preview.screens[0];
  }, [preview.screens, activeScreenId]);

  if (!activeScreen) {
    return null;
  }

  return (
    <div className="phone">
      <div className="phone-header">
        <p className="phone-title" style={{ color: preview.primaryColor }}>
          {preview.appName}
        </p>
        <p className="phone-description">{activeScreen.description}</p>
      </div>

      <div className="phone-body">
        {activeScreen.blocks.map((block) => (
          <div className="block-chip" key={block}>
            {block}
          </div>
        ))}
      </div>

      <div className="tabs">
        {preview.screens.map((screen) => (
          <button
            key={screen.id}
            className={`tab-button ${screen.id === activeScreen.id ? "tab-button-active" : ""}`}
            style={screen.id === activeScreen.id ? { background: preview.primaryColor } : undefined}
            onClick={() => setActiveScreenId(screen.id)}
            type="button"
          >
            {screen.title}
          </button>
        ))}
      </div>
    </div>
  );
}
