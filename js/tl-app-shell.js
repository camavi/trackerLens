(() => {
  const root = document.getElementById("tl-desktop-shell-root");
  if (!root) return;

  const rail = _.div({ class: "tl-desktop-nav-rail" });
  const outlet = _.main({ class: "tl-desktop-view-outlet", "aria-live": "polite" });
  const setActive = (activeId) => rail.replaceChildren(window.TrackerLensSidebar.render({ activeId }));
  window.TrackerLensAppShell = { setActive };
  setActive("library");
  root.replaceChildren(
    _.div(
      { class: "tl-desktop-shell" },
      window.TrackerLensSidebar.renderBrand({ className: "tl-desktop-app-brand", showChevron: true }),
      rail,
      outlet
    )
  );

  const router = window.TrackerLensAppRouter;
  const libraryView = window.TrackerLensViews?.library;
  const settingsView = window.TrackerLensViews?.settings;
  const aiView = window.TrackerLensViews?.ai;
  const pythonRuntimeView = window.TrackerLensViews?.pythonRuntime;
  const analyticsView = window.TrackerLensViews?.analytics;
  const connectionsView = window.TrackerLensViews?.connections;
  const devtoolsView = window.TrackerLensViews?.devtools;
  const profileView = window.TrackerLensViews?.profile;
  const databaseView = window.TrackerLensViews?.database;
  const flowLibraryView = window.TrackerLensViews?.flowLibrary;
  const workspaceView = window.TrackerLensViews?.workspace;
  const flowMapView = window.TrackerLensViews?.flowMap;
  if (!router || !libraryView || !settingsView || !aiView || !pythonRuntimeView || !analyticsView || !connectionsView || !devtoolsView || !profileView || !databaseView || !flowLibraryView || !workspaceView || !flowMapView) throw new Error("La shell desktop richiede router, Libreria, Impostazioni, AI, Runtime Python, Statistiche, Collegamenti, DevTools, Profilo, Database, Library Flow Map, Workspace e Flow Map.");
  router.register("/app.html", libraryView);
  router.register("/library.html", libraryView);
  router.register("/settings.html", settingsView);
  router.register("/ai.html", aiView);
  router.register("/pythonRuntime.html", pythonRuntimeView);
  router.register("/analytics.html", analyticsView);
  router.register("/connections.html", connectionsView);
  router.register("/devtools.html", devtoolsView);
  router.register("/profile.html", profileView);
  router.register("/database.html", databaseView);
  router.register("/libraryFlowmap.html", flowLibraryView);
  router.register("/editorWorkspace.html", workspaceView);
  router.register("/flowMap.html", flowMapView);
  void router.start(outlet);
})();
