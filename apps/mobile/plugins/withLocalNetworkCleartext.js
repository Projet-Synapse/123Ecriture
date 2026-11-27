// ✒️ 123ECRITURE — plugins/withLocalNetworkCleartext.js — HTTP local dans l'APK publié (v0.5.1)
//
// Android (cible ≥ 28) refuse par défaut tout HTTP non chiffré dans les
// builds « release » : Ellie ne pouvait pas joindre Ollama sur le PC
// (`http://IP-du-PC:11434`). Ce plugin Expo, appliqué à chaque
// `expo prebuild` (CI comprise), ajoute :
//   • res/xml/network_security_config.xml : base-config
//     cleartextTrafficPermitted="true" (certificats système) ;
//   • android:networkSecurityConfig sur <application>.
// Pourquoi base-config et pas une liste de domain-config : Android ne
// connaît pas les plages d'adresses (CIDR), seulement des noms/IP exacts,
// or l'IP du PC change d'un réseau à l'autre. La restriction au RÉSEAU
// LOCAL est faite côté code : lib/ai/localHttpGuard.ts refuse tout
// http:// hors adresses privées / Tailscale / .local. https:// inchangé.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par plugins/withLocalNetworkCleartext.js (123Écriture) — ne pas modifier à la main. -->
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function withNetworkSecurityFile(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'network_security_config.xml'), XML);
      return cfg;
    },
  ]);
}

function withNetworkSecurityManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });
}

module.exports = function withLocalNetworkCleartext(config) {
  return withNetworkSecurityManifest(withNetworkSecurityFile(config));
};
module.exports.NETWORK_SECURITY_XML = XML;
