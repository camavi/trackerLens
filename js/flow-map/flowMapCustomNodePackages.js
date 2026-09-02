// Core-owned Custom Node package import/review UI. Package code is never loaded here.
window.TrackerLensCustomNodePackages = (() => {
  let installed = [];
  const bridge = () => window.trackers?.desktop?.customNodePackages || null;
  const isAvailable = () => Boolean(bridge()?.inspect && bridge()?.install && bridge()?.list && bridge()?.grantPermissions && bridge()?.activateSandboxRuntime);
  const declaredPermissions = (permissions = {}) => Object.entries(permissions || {})
    .filter(([, value]) => Boolean(value) && value !== "none")
    .map(([key, value]) => value === true ? `custom.${key}` : `custom.${key}.${value}`);
  const paletteItem = (pkg = {}) => {
    const manifest = pkg.manifest || {};
    const sandboxed = pkg.runtimeExecution === "sandboxed";
    return {
      label: pkg.name || manifest.name || pkg.packageId || "Custom Node",
      icon: manifest.icon || "extension",
      tone: "gold",
      nodeType: "custom",
      subtype: pkg.subtype || manifest.subtype || pkg.packageId || "custom-package",
      category: "custom-packages",
      inputs: manifest.inputs || [],
      outputs: manifest.outputs || [],
      // This is a normalized display/graph permission list. The original
      // declared object stays in metadata below for the review surface.
      permissions: declaredPermissions(pkg.permissions || manifest.permissions),
      settingsSchema: manifest.ui?.settingsSchema || manifest.settingsSchema || {},
      runtime: { execution: sandboxed ? "sandboxed" : "blocked", installState: pkg.installState || "manifest-only" },
      manifest: { ...manifest, permissions: declaredPermissions(pkg.permissions || manifest.permissions) },
      customPackage: {
        packageId: pkg.packageId,
        version: pkg.version,
        archive: pkg.archive || {},
        trustLevel: pkg.trustLevel || "local-dev",
        installState: pkg.installState || "manifest-only",
        runtimeExecution: sandboxed ? "sandboxed" : "blocked",
        declaredPermissions: pkg.permissions || manifest.permissions || {},
      },
      connectionType: sandboxed ? "Custom package · sandboxed runtime" : "Custom package · runtime blocked",
      runtimeBlocked: !sandboxed,
    };
  };
  const notifyPaletteChanged = () => window.dispatchEvent(new CustomEvent("trackers-custom-node-packages-updated", { detail: { packages: installed } }));
  const refreshInstalled = async () => {
    if (!isAvailable()) { installed = []; return installed; }
    installed = await bridge().list().catch(() => []);
    notifyPaletteChanged();
    return installed;
  };
  const paletteGroups = () => installed.length ? [["Custom Packages", installed.map(paletteItem)]] : [];
  const permissionText = (permissions = {}) => [
    permissions.network ? "network" : null,
    permissions.filesystem ? "filesystem" : null,
    permissions.aiProvider ? "AI provider" : null,
    permissions.memory ? "memory" : null,
    permissions.runtimeGraph && permissions.runtimeGraph !== "none" ? `runtime graph: ${permissions.runtimeGraph}` : null,
  ].filter(Boolean);
  const summary = (pkg = {}, { onGrantPermissions = null, onActivateSandbox = null } = {}) => {
    const manifest = pkg.manifest || {};
    const permissions = permissionText(pkg.permissions || manifest.permissions || {});
    const analysis = pkg.staticAnalysis || {};
    const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
    const undeclared = findings.filter((finding) => finding.permission && finding.permissionDeclared === false);
    const consent = pkg.permissionConsent || {};
    return _.article(
      { class: "tl-flow-package-card" },
      _.div({ class: "tl-flow-package-card-title" }, flowMapIcon(manifest.icon || "extension", "sm"), _.strong(pkg.name || manifest.name || pkg.packageId), _.span(`${pkg.version || manifest.version || ""}`)),
      _.p(`${pkg.publisher || manifest.publisher || "Local package"} · ${pkg.category || manifest.category || "custom"}`),
      _.p({ class: "tl-flow-package-card-state" }, `Trust: ${pkg.trustLevel || "local-dev"} · Runtime: ${pkg.runtimeExecution === "sandboxed" ? "sandboxed" : "blocked"}`),
      _.p(permissions.length ? `Permessi dichiarati: ${permissions.join(", ")}` : "Nessun permesso dichiarato."),
      _.p(`Consenso runtime: ${consent.status === "granted" ? "registrato" : "non concesso"} · runtime ancora bloccato.`),
      consent.status !== "granted" && typeof onGrantPermissions === "function"
        ? _.div({ class: "tl-flow-package-actions" }, flowMapBtn({ onclick: () => onGrantPermissions(pkg) }, "Registra consenso ai permessi dichiarati"))
        : null,
      consent.status === "granted" && pkg.runtimeExecution !== "sandboxed" && typeof onActivateSandbox === "function"
        ? _.div({ class: "tl-flow-package-actions" }, flowMapBtn({ class: "st-btn-warning", onclick: () => onActivateSandbox(pkg) }, "Attiva sandbox sperimentale"))
        : null,
      analysis.status === "reviewed"
        ? _.p({ class: undeclared.length ? "tl-flow-package-card-state" : "" }, undeclared.length
          ? `Audit statico: ${undeclared.length} uso/i di API senza permesso dichiarato.`
          : findings.length ? `Audit statico: ${findings.length} segnalazione/i da verificare.` : "Audit statico: nessuna API sensibile rilevata.")
        : null,
      _.p(`${(pkg.files || []).length} file · SHA-256 ${pkg.archive?.sha256 || pkg.archiveSha256 || ""}`)
    );
  };
  const openDialog = async () => {
    if (!isAvailable()) return CMSwift.notify?.error?.("L'import Custom Node è disponibile solo nell'app desktop.");
    let packages = await refreshInstalled();
    let review = null;
    let busy = false;
    let dialog = null;
    const render = () => _.div(
      { class: "tl-flow-package-dialog-body" },
      _.p("Importa un archivio .tl-node.zip. Il manifest e i permessi vengono revisionati prima della copia; runtime.js resta bloccato."),
      review ? _.section({ class: "tl-flow-package-review" }, _.h3("Revisione import"), summary(review), _.div({ class: "tl-flow-package-actions" },
        flowMapBtn({ class: "st-btn-primary", disabled: busy, onclick: async () => {
          busy = true; refresh();
          try { await bridge().install({ importId: review.importId }); review = null; packages = await refreshInstalled(); CMSwift.notify?.success?.("Custom Node importato: aggiungilo dalla palette, runtime bloccato."); }
          catch (error) { CMSwift.notify?.error?.(error?.message || "Import non riuscito."); }
          finally { busy = false; refresh(); }
        } }, flowMapIcon("archive", "sm"), busy ? "Importazione…" : "Importa pacchetto"),
        flowMapBtn({ disabled: busy, onclick: () => { review = null; refresh(); } }, "Annulla")
      )) : _.div({ class: "tl-flow-package-actions" }, flowMapBtn({ class: "st-btn-primary", disabled: busy, onclick: async () => {
        busy = true; refresh();
        try { const result = await bridge().inspect(); if (!result?.cancelled) review = result; }
        catch (error) { CMSwift.notify?.error?.(error?.message || "Archivio non valido."); }
        finally { busy = false; refresh(); }
      } }, flowMapIcon("upload_file", "sm"), busy ? "Lettura…" : "Scegli .tl-node.zip")),
      _.hr(), _.h3("Pacchetti installati"), packages.length ? _.div({ class: "tl-flow-package-list" }, ...packages.map((pkg) => summary(pkg, {
        onGrantPermissions: async (target) => {
          busy = true; refresh();
          try {
            await bridge().grantPermissions({
              packageId: target.packageId,
              version: target.version,
              archiveSha256: target.archive?.sha256,
              permissions: target.permissions || target.manifest?.permissions || {},
              confirmed: true
            });
            packages = await refreshInstalled();
            CMSwift.notify?.success?.("Consenso registrato. Il runtime rimane bloccato finché la sandbox non sarà disponibile.");
          } catch (error) { CMSwift.notify?.error?.(error?.message || "Registrazione consenso non riuscita."); }
          finally { busy = false; refresh(); }
        },
        onActivateSandbox: (target) => {
          const confirmDialog = _.Dialog({
            title: "Attivare runtime sandbox?", subtitle: `${target.name || target.packageId} ${target.version}`,
            content: () => _.div(_.p("Il package locale può ora elaborare i dati che riceve dal Flow Map dentro una sandbox isolata."), _.p("La sandbox non rende affidabile codice non verificato. Verifica manifest, permessi e audit statico prima di continuare.")),
            footer: () => [flowMapBtn({ onclick: () => confirmDialog.close() }, "Annulla"), flowMapBtn({ class: "st-btn-warning", onclick: async () => {
              busy = true; confirmDialog.close(); refresh();
              try { await bridge().activateSandboxRuntime({ packageId: target.packageId, version: target.version, archiveSha256: target.archive?.sha256, confirmed: true }); packages = await refreshInstalled(); CMSwift.notify?.success?.("Sandbox attivata per questa esatta versione del package."); }
              catch (error) { CMSwift.notify?.error?.(error?.message || "Attivazione sandbox non riuscita."); }
              finally { busy = false; refresh(); }
            } }, "Attiva")]
          });
          confirmDialog.open();
        }
      }))) : _.p("Nessun Custom Node installato.")
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
      footer: () => flowMapBtn({ onclick: () => dialog?.close?.() }, "Chiudi")
    });
    dialog.open();
  };
  if (isAvailable()) refreshInstalled();
  return Object.freeze({ isAvailable, openDialog, paletteGroups, refreshInstalled });
})();
