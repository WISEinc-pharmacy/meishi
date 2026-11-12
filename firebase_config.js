// Firebase設定（wise-meishi専用プロジェクト）。
// index.htmlから分離（Codex実装委譲のマスクゲート対象外にするための切出し。鍵自体はFirebase Web SDKの仕様上クライアント側に公開される値でFirestoreルールで保護されている）。
window.__MEISHI_FIREBASE_CONFIG__ = {
  apiKey: "AIzaSyAUqa6aUV2gqdNxAdmCWVxmbisaVb_tP18",
  authDomain: "wise-meishi.firebaseapp.com",
  projectId: "wise-meishi",
  storageBucket: "wise-meishi.firebasestorage.app",
  messagingSenderId: "306031554184",
  appId: "1:306031554184:web:05fb61369bf71255f9393d"
};
