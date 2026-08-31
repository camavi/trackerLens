// Core-owned Custom Node package import/review UI. Package code is never loaded here.
window.TrackerLensCustomNodePackages = (() => {
  const bridge = () => window.trackers?.desktop?.customNodePackages || null;
  const isAvailable = () => Boolean(bridge()?.inspect && bridge()?.install && bridge()?.list);
  const permissionText = (permissions = {}) => [
    permissions.network ? "network" : null,
    permissions.filesystem ? "filesystem" : null,
    permissions.aiProvider ? "AI provider" : null,
    permissions.memory ? "memory" : null,
    permissions.runtimeGraph && permissions.runtimeGraph !== "none" ? `runtime graph: ${permissions.runtimeGraph}` : null,
  ].filter(Boolean);
  const summary = (pkg = {}) => {
    const manifest = pkg.manifest || {};
    const permissions = permissionText(pkg.permissions || manifest.permissions || {});
    return _.article(
      { class: "tl-flow-package-card" },
      _.div({ class: "tl-flow-package-card-title" }, icon(manifest.icon || "extension", "sm"), _.strong(pkg.name || manifest.name || pkg.packageId), _.span(`${pkg.version || manifest.version || ""}`)),
      _.p(`${pkg.publisher || manifest.publisher || "Local package"} · ${pkg.category || manifest.category || "custom"}`),
      _.p({ class: "tl-flow-package-card-state" }, `Trust: ${pkg.trustLevel || "local-dev"} · Runtime: blocked`),
      _.p(permissions.length ? `Permessi dichiarati: ${permissions.join(", ")}` : "Nessun permesso dichiarato."),
      _.p(`${(pkg.files || []).length} file · SHA-256 ${pkg.archive?.sha256 || pkg.archiveSha256 || ""}`)
    );
  };
  const openDialog = async () => {
    if (!isAvailable()) return CMSwift.notify?.error?.("L'import Custom Node è disponibile solo nell'app desktop.");
    let packages = await bridge().list().catch(() => []);
    let review = null;
    let busy = false;
    let dialog = null;
    const render = () => _.div(
      { class: "tl-flow-package-dialog-body" },
      _.p("Importa un archivio .tl-node.zip. Il manifest e i permessi vengono revisionati prima della copia; runtime.js resta bloccato."),
      review ? _.section({ class: "tl-flow-package-review" }, _.h3("Revisione import"), summary(review), _.div({ class: "tl-flow-package-actions" },
        btn({ class: "st-btn-primary", disabled: busy, onclick: async () => {
          busy = true; refresh();
          try { await bridge().install({ importId: review.importId }); review = null; packages = await bridge().list(); CMSwift.notify?.success?.("Custom Node importato: runtime bloccato."); }
          catch (error) { CMSwift.notify?.error?.(error?.message || "Import non riuscito."); }
          finally { busy = false; refresh(); }
        } }, icon("archive", "sm"), busy ? "Importazione…" : "Importa pacchetto"),
        btn({ disabled: busy, onclick: () => { review = null; refresh(); } }, "Annulla")
      )) : _.div({ class: "tl-flow-package-actions" }, btn({ class: "st-btn-primary", disabled: busy, onclick: async () => {
        busy = true; refresh();
        try { const result = await bridge().inspect(); if (!result?.cancelled) review = result; }
        catch (error) { CMSwift.notify?.error?.(error?.message || "Archivio non valido."); }
        finally { busy = false; refresh(); }
      } }, icon("upload_file", "sm"), busy ? "Lettura…" : "Scegli .tl-node.zip")),
      _.hr(), _.h3("Pacchetti installati"), packages.length ? _.div({ class: "tl-flow-package-list" }, ...packages.map(summary)) : _.p("Nessun Custom Node installato.")
    );
    const refresh = () => {
      const host = document.querySelector("[data-custom-node-package-dialog]");
      if (host) host.replaceWith(_.div({ "data-custom-node-package-dialog": "true" }, render()));
    };
    dialog = _.Dialog({
      class: "tl-flow-package-dialog",
      title: "Custom Node Packages",
      subtitle: "Manifest-only import · codice runtime disabilitato",
      content: () => _.div({ "data-custom-node-package-dialog": "true" }, render()),
      footer: () => btn({ onclick: () => dialog?.close?.() }, "Chiudi")
    });
    dialog.open();
  };
  return Object.freeze({ isAvailable, openDialog });
})();
