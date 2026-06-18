window.TrackerLensSidebar = (() => {
  const defaultItems = [
    { id: "library", icon: "folder_open", label: "Asset", url: "library.html" },
    { id: "flow", icon: "account_tree", label: "Flow Map", url: "libraryFlowmap.html" },
    { id: "dashboard", icon: "dashboard", label: "Aggiungi box", url: "editorWorkspace.html" },
    { id: "links", icon: "link", label: "Collegamenti", url: "connections.html" },
    { id: "database", icon: "database", label: "Database", url: "database.html" },
    { id: "devtools", icon: "developer_board", label: "DevTools", url: "devtools.html" },
    { id: "stats", icon: "monitoring", label: "Statistiche", url: "analytics.html" },
    { id: "ai", icon: "psychology", label: "AI", url: "ai.html" },
    { id: "settings", icon: "settings", label: "Impostazioni", url: "settings.html" },
  ];

  const navigate = (url) => {
    if (!url) return;
    window.location.assign(url);
  };

  const renderButton = (item, activeId) =>
    _.Btn(
      {
        type: "button",
        class: `tl-view-side-btn${item.id === activeId ? " is-active" : ""}`,
        "aria-label": item.label,
        title: item.label,
        onclick: () => navigate(item.url),
      },
      _.Icon({ name: item.icon, size: "md" })
    );

  const renderBrand = ({ className = "tl-app-brand", showChevron = true } = {}) =>
    _.div(
      { class: `${className} tl-brand-lockup` },
      _.span({ class: "tl-brand-mark", "aria-hidden": "true" }),
      _.h1({ class: "tl-brand-title" }, "TRACKERS ", _.span("LENS")),
      showChevron ? _.Icon({ name: "chevron_right", size: "sm" }) : null
    );

  const render = ({ activeId = "dashboard", items = defaultItems, onHelp = null } = {}) =>
    _.aside(
      { class: "tl-view-sidebar", "aria-label": "Navigazione workspace" },
      _.nav({ class: "tl-view-nav" }, ...items.map((item) => renderButton(item, activeId))),
      _.div(
        { class: "tl-view-sidebar-bottom" },
        _.Btn(
          {
            type: "button",
            class: "tl-view-side-btn",
            "aria-label": "Aiuto",
            onclick: typeof onHelp === "function" ? onHelp : undefined,
          },
          _.Icon({ name: "help_outline", size: "md" })
        ),
        _.Btn(
          {
            type: "button",
            class: `tl-view-profile${activeId === "profile" ? " is-active" : ""}`,
            "aria-label": "Profilo utente",
            onclick: () => navigate("profile.html"),
          },
          _.span({ class: "tl-view-profile-avatar", "aria-hidden": "true" }),
          _.span({ class: "tl-profile-dot", "aria-hidden": "true" })
        )
      )
    );

  return {
    defaultItems,
    navigate,
    renderBrand,
    render,
  };
})();
