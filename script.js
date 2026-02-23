console.log("🚀 INIT script.js", {
  href: location.href,
  isTop: window === window.top,
  referrer: document.referrer,
  scriptCount: document.querySelectorAll("script[src]").length,
});
console.trace("📌 TRACE init script.js");

// erros globais (pode ficar fora do main, ok)
window.addEventListener("error", (e) => {
  console.error("❌ ERRO GLOBAL:", e.message, e.filename, e.lineno);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("❌ PROMISE NÃO TRATADA:", e.reason);
});

// ✅ bloqueia segunda execução (top-level)
if (window.__STRONDA_APP_INIT__) {
  console.warn("⚠️ script.js já foi iniciado. Ignorando segunda execução.");
} else {
  window.__STRONDA_APP_INIT__ = true;

  window.addEventListener("DOMContentLoaded", () => {
    boot().catch((e) => console.error("❌ boot() falhou:", e));
  });
}

// ✅ helpers globais de permissão (precisa existir ANTES do boot)
window.isAdmin = function isAdmin() {
  const t = String(window.sessaoUsuario?.tipo || "").toUpperCase();
  return t === "ADMIN" || t === "MASTER";
};

window.isMaster = function isMaster() {
  const t = String(window.sessaoUsuario?.tipo || "").toUpperCase();
  return t === "MASTER";
};

window.isColab = function isColab() {
  const t = String(window.sessaoUsuario?.tipo || "").toUpperCase();
  return t === "COLAB" || t === "COLABORADOR";
};




async function boot() {
  console.log("🚀 boot() start");

  await ensureAuth();

  const emp = localStorage.getItem("empresaAtualId") || EMPRESA_PRINCIPAL_ID;
  setEmpresaAtual(emp);

  await carregarDadosUmaVezParaLogin();

  iniciarFormulario();
  ligarEventosOcorrenciaPublica();

  aplicarClassePermissaoBody();
  aplicarPermissoesMenu();
  aplicarPermissoesUI();
  ativarProtecaoCadastroMaquina();
  blindarIconeOcorrencias();

  listarMaquinas();
  atualizarStatus();
  listarOcorrencias();
  atualizarAlertaOcorrencias();

  if (sessaoUsuario) {
    pararSnapshotAtual();
    __syncAtivo = false;
    await iniciarSincronizacaoFirebase();
  }

  // ✅ liga automático: ao clicar "Selecionar Empresa" injeta Bloquear/Desbloquear
  try { ligarGanchoSelecionarEmpresaParaInjetarBloqueio(); } catch {}

  console.log("✅ boot() ok");
}

console.log("✅ script.js carregou!");

// ✅ Firebase App (CDN)
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

// ✅ Firestore (CDN)
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  arrayUnion, 
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ✅ Auth (CDN)
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// ✅ Storage (CDN)  << COLE AQUI
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";


// 1) Firebase config (use o seu do painel)
const firebaseConfig = {
  apiKey: "AIzaSyDwKkCtERVgvOsmEH1X_T1gqn66bDRHsYo",
  authDomain: "stronda-music-controle.firebaseapp.com",
  projectId: "stronda-music-controle",
  storageBucket: "stronda-music-controle.firebasestorage.app",
  messagingSenderId: "339385914034",
  appId: "1:339385914034:web:601d747b7151d507ad6fab"
};

// ✅ (3) Inicialização segura (não duplica app)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ (4) Logs de debug (coloca logo abaixo do app)
console.log("Firebase apps:", getApps().length);
console.log("apiKey em uso:", app.options.apiKey);
console.log("config completo:", app.options);

// Firebase services
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

let _fcModo = "DIARIO";
let __authReady = null;



function ensureAuth() {
  if (__authReady) return __authReady;

  __authReady = new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          unsub?.();
          return resolve(user);
        }
        await signInAnonymously(auth);
        // vai disparar o onAuthStateChanged de novo com user
      } catch (e) {
        unsub?.();
        reject(e);
      }
    });
  });

  return __authReady;
}


// =====================
// ✅ EMPRESA PRINCIPAL
// =====================
const EMPRESA_PRINCIPAL_ID   = "STRONDA-MUSIC";
const EMPRESA_PRINCIPAL_NOME = "STRONDA MUSIC";
const EMPRESA_PRINCIPAL = EMPRESA_PRINCIPAL_ID; // ✅ compatibilidade com código antigo




// =====================
// 🔥 FIREBASE (Firestore)
// =====================

// 6) Exemplo de submit do formulário (ajuste IDs do seu HTML)
function iniciarFormulario() {
  const form = document.getElementById("formMaquina");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nome = document.getElementById("nomeMaquina")?.value;
    const serie = document.getElementById("serieMaquina")?.value;
    const local = document.getElementById("localMaquina")?.value;

    try {
      await cadastrarMaquina({ nome, serie, local });
      form.reset();
    } catch (err) {
      alert(err.message || "Erro ao cadastrar máquina.");
      console.error(err);
    }
  });
}


function iniciarListaMaquinas() {
  // TODO: implementar depois
  console.log("iniciarListaMaquinas: ainda não implementado");
}



// ✅ agora sim pode expor no console
window.__db = db;


// ✅ e só agora pode usar doc(db,...)
const EMPRESAS_LIST_DOC = doc(db, "appEmpresas", "lista");


let __retryQuotaTimer = null;
let __firestoreBloqueado = false;
let __avisouQuotaOffline = false;

function isQuotaErr(err) {
  const code = String(err?.code || "");
  const msg  = String(err?.message || "");
  return code.includes("resource-exhausted") || /quota/i.test(msg);
}

// ===============================
// ✅ BACKUP LOCAL (anti-perda)
// ===============================
function keyBackupEmpresa(empId) {
  const id = String(
    empId ||
    empresaAtualId ||
    localStorage.getItem("empresaAtualId") ||
    EMPRESA_PRINCIPAL_ID
  ).trim().toUpperCase();

  return `backup_${id}`;
}



function salvarBackupLocal() {
  try {
    const payload = {
      versao: 1,
      empresa: (empresaAtualId || localStorage.getItem("empresaAtualId") || EMPRESA_PRINCIPAL_ID),
      salvoEm: new Date().toISOString(),
      dados: { ocorrencias, maquinas, acertos, usuarios },
    };

    localStorage.setItem(keyBackupEmpresa(payload.empresa), JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn("backup local falhou:", e);
    return false;
  }
}



function carregarBackupLocal(empId = null) {
  try {
    const emp = String(
      empId ||
      empresaAtualId ||
      localStorage.getItem("empresaAtualId") ||
      EMPRESA_PRINCIPAL_ID
    ).trim().toUpperCase();

    const raw = localStorage.getItem(keyBackupEmpresa(emp));
    if (!raw) return false;

    const obj = JSON.parse(raw);
    const d = obj?.dados || {};

    if (Array.isArray(d.ocorrencias)) ocorrencias = d.ocorrencias;
    if (Array.isArray(d.maquinas))    maquinas    = d.maquinas.map(normalizarGPSMaquina);
    if (Array.isArray(d.acertos))     acertos     = d.acertos;
    if (Array.isArray(d.usuarios))    usuarios    = d.usuarios;

    return true;
  } catch (e) {
    console.warn("carregar backup local falhou:", e);
    return false;
  }
}


// ✅ Busca estabelecimento pelo número da máquina dentro da empresa escolhida (tela pública)
async function buscarEstabPorEmpresaENumero(empId, numero) {
  try {
    empId = String(empId || "").trim().toUpperCase();
    numero = String(numero || "").trim().toUpperCase();
    if (!empId || !numero) return "";

    await ensureAuth();

    const ref = doc(db, "empresas", empId, "dados", "app");
    const snap = await getDoc(ref);
    if (!snap.exists()) return "";

    const data = snap.data() || {};
    const lista = Array.isArray(data.maquinas) ? data.maquinas : [];
    const m = lista.find(x => String(x.numero || "").toUpperCase() === numero);

    return m ? String(m.estab || "").toUpperCase() : "";
  } catch (e) {
    console.error("buscarEstabPorEmpresaENumero erro:", e);
    if (isQuotaErr(e)) {
      try { entrarModoOfflinePorQuota(e); } catch {}
    }
    return "";
  }
}


const RETRY_QUOTA_MS = 60 * 60 * 1000; // ✅ 1 hora (DECIDIDO)


function normalizaEmpresaId(valor) {
  return String(valor || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-"); // espaço vira hífen
}




function entrarModoOfflinePorQuota(err) {
  __firestoreBloqueado = true;
  pararSnapshotAtual();

  firebasePronto = true;
  habilitarBotaoLogin();

  const ok = carregarBackupLocal();
  try { listarMaquinas(); } catch {}
  try { atualizarStatus(); } catch {}
  try { listarOcorrencias(); } catch {}

  if (!__avisouQuotaOffline) {
    __avisouQuotaOffline = true;
    alert(
      "⚠️ Firestore estourou a quota (resource-exhausted).\n\n" +
      "✅ Vou rodar em MODO OFFLINE usando o backup local.\n" +
      "⛔ Sincronização entre celular/PC fica pausada até a quota normalizar.\n\n" +
      (ok ? "✅ Backup local carregado." : "⚠️ Não achei backup local dessa empresa.")
    );
  }

  clearTimeout(__retryQuotaTimer);
  __retryQuotaTimer = setTimeout(() => {
    __firestoreBloqueado = false;
    __avisouQuotaOffline = false;
    iniciarSincronizacaoFirebase();
  }, RETRY_QUOTA_MS);
}

// ✅ UM ÚNICO DOC COM TODOS OS DADOS (mais simples)
let empresaAtualId = null;
let docRef = null;
let unsubSnapshot = null;
let empresaAtual = null;
let __syncAtivo = false;     // indica que snapshot está ligado
let __syncIniciando = false; // evita iniciar duas vezes ao mesmo tempo
let __authPromise = null;


window.buscarEstabPorEmpresaENumero = buscarEstabPorEmpresaENumero;


function esconderBotaoCadastroMaquinaDoColab() {
  if (typeof isAdmin !== "function" || !isAdmin()) return;


  const botoes = document.querySelectorAll("#menu button, #menu .btn, #menu a, #menu div");
  botoes.forEach(b => {
    if ((b.textContent || "").toUpperCase().includes("CADASTRO DE MÁQUINA")) {
      b.style.display = "none";
    }
  });
}


// =====================
// 🏷️ DEPÓSITO (nome automático)
// =====================
let empresaPerfil = {}; // ✅ vamos carregar do Firestore junto com maquinas/usuarios etc

// =====================
// 🔒 BLOQUEIO MANUAL (helpers)
// =====================
function empresaEstaBloqueada(perfil) {
  const p = perfil && typeof perfil === "object" ? perfil : {};
  return p.manualBlocked === true;
}

function motivoBloqueioEmpresa(perfil) {
  const p = perfil && typeof perfil === "object" ? perfil : {};
  if (p.manualBlocked) return p.manualBlockedReason || "empresa bloqueada manualmente";
  return "";
}

// =====================
// 🚫 ESCONDER TROCA SENHA MASTER FORA DA STRONDA (BLINDADO)
// =====================
function esconderTrocaSenhaMasterForaDaStronda() {
  const principal = String(EMPRESA_PRINCIPAL_ID || "").toUpperCase();
  const emp = String(empresaAtualId || "").toUpperCase();

  const menu = document.getElementById("menu");
  if (!menu) return;

  const tipoSessao = String((window.sessaoUsuario && window.sessaoUsuario.tipo) || "").toUpperCase();
  const isMaster = (tipoSessao === "MASTER");
  if (!isMaster) return;

  const deveMostrar = (emp === principal);

  const botoes = menu.querySelectorAll("button");
  botoes.forEach((b) => {
    const t = String(b.textContent || "").toUpperCase().trim();

    const ehBotaoMaster =
      (t.includes("TROCAR SENHA") && t.includes("MASTER")) ||
      (t.includes("TROCAR SENHA ADMINISTRADOR") && t.includes("MASTER"));

    if (ehBotaoMaster) {
      b.style.display = deveMostrar ? "" : "none";
    }
  });
}

function ligarObserverEsconderMaster() {
  if (window.__obsHideMasterBtn) return;

  const menu = document.getElementById("menu");
  if (!menu) {
    setTimeout(ligarObserverEsconderMaster, 500);
    return;
  }

  window.__obsHideMasterBtn = new MutationObserver(() => {
    try { esconderTrocaSenhaMasterForaDaStronda(); } catch {}
  });

  window.__obsHideMasterBtn.observe(menu, {
    childList: true,
    subtree: true,
  });

  try { esconderTrocaSenhaMasterForaDaStronda(); } catch {}
}


function nomeEmpresaAtual() {
  const emp = String(empresaAtualId || EMPRESA_PRINCIPAL_ID).toUpperCase();
  if (emp === EMPRESA_PRINCIPAL_ID.toUpperCase()) return EMPRESA_PRINCIPAL_NOME;
  return emp;
}

async function atualizarNomeEmpresaNaTela() {
  const el = document.getElementById("empresaNomeTopo"); // <- TROQUE pro seu ID real
  if (!el) return;

  // se tiver função de nome bonito no Firestore, usa ela:
  if (typeof getNomeBonitoEmpresa === "function") {
    const bonito = await getNomeBonitoEmpresa(empresaAtualId || EMPRESA_PRINCIPAL_ID);
    el.textContent = (bonito || nomeEmpresaAtual()).toUpperCase();
    return;
  }

  el.textContent = nomeEmpresaAtual().toUpperCase();
}



function labelDeposito() {
  const empId = String(empresaAtualId || EMPRESA_PRINCIPAL_ID).toUpperCase();
  if (empId === EMPRESA_PRINCIPAL_ID.toUpperCase()) {
    return `DEPOSITO ${EMPRESA_PRINCIPAL_NOME.toUpperCase()}`;
  }
  return `DEPOSITO ${empId}`;
}


async function labelDepositoAsync() {
  const empId = String(empresaAtualId || EMPRESA_PRINCIPAL_ID).toUpperCase();
  const nome = await getNomeBonitoEmpresa(empId);
  return `DEPOSITO ${String(nome || empId).toUpperCase()}`;
}




function isDepositoStatus(st) {
  return normalizarStatus(st) === "DEPOSITO";
}


function abrirFechamentoCaixa() {
  if (!exigirAdmin()) return;
  abrir("fechamentoCaixa");
  setPeriodoHojeFechamento();
  ligarEventosFechamentoCaixa();
  renderFechamentoCaixa();
}


window.abrirFechamentoCaixa = abrirFechamentoCaixa;


function setEmpresaAtual(empresaId) {
  empresaAtualId = normalizaEmpresaId(empresaId || EMPRESA_PRINCIPAL_ID);
  empresaAtual = empresaAtualId;
  localStorage.setItem("empresaAtualId", empresaAtualId);

  // ✅ ZERA DADOS ANTIGOS (pra não mostrar STRONDA em empresa vazia)
  maquinas = null;      // null = "carregando..."
  usuarios = [];
  acertos = [];
  ocorrencias = [];
  empresaPerfil = {};

  // ✅ docRef da empresa atual
  docRef = doc(db, "empresas", empresaAtualId, "dados", "app");

  // atualiza nome no topo (se existir)
  try { atualizarNomeEmpresaNaTela(); } catch {}

  return empresaAtualId;
}

function aplicarDadosDoFirestore(data) {
  maquinas      = Array.isArray(data.maquinas) ? data.maquinas : [];
  usuarios      = Array.isArray(data.usuarios) ? data.usuarios : [];
  acertos       = Array.isArray(data.acertos) ? data.acertos : [];
  ocorrencias   = Array.isArray(data.ocorrencias) ? data.ocorrencias : [];
  empresaPerfil = (data.empresaPerfil && typeof data.empresaPerfil === "object") ? data.empresaPerfil : {};
}

async function garantirDocExiste() {
  if (!docRef) throw new Error("docRef está null. Chame setEmpresaAtual() antes.");

  const snap = await getDoc(docRef);
  if (snap.exists()) return true;

  await setDoc(docRef, {
    atualizadoEm: new Date().toISOString(),
    ocorrencias: [],
    maquinas: [],
    acertos: [],
    usuarios: []
  });

  return true;
}





// estado do app (vai substituir localStorage)
let ocorrencias = [];
let maquinas = [];
let acertos = [];
let usuarios = [];
let sessaoUsuario = null;
let firebasePronto = false;
let __savePendente = false;


// ==========================
// 💳 CRÉDITOS REMOTOS (ADMIN)
// ==========================

// auto preencher estabelecimento ao digitar número da máquina
function crAutoPorNumero() {
  const numEl = document.getElementById("crNum");
  const estabEl = document.getElementById("crEstab");
  const info = document.getElementById("crInfo");

  if (!numEl || !estabEl) return;

  const num = (numEl.value || "").trim().toUpperCase();
  numEl.value = num;

  if (!num) {
    estabEl.value = "";
    if (info) info.textContent = "";
    return;
  }

  const m = maquinas.find(x => String(x.numero || "").toUpperCase() === num);

  if (!m) {
    estabEl.value = "❌ MÁQUINA NÃO ENCONTRADA";
    if (info) info.textContent = "";
    return;
  }

  estabEl.value = String(m.estab || "").toUpperCase();

  const ult = m.ultimoRelogio != null ? Number(m.ultimoRelogio) : 0;
  if (info) info.innerHTML = `📌 Último relógio atual: <b>${ult.toFixed(2)}</b>`;
}

function pararSnapshotAtual() {
  try {
    if (typeof unsubSnapshot === "function") unsubSnapshot();
  } catch {}
  unsubSnapshot = null;
  __syncAtivo = false;
}

function numJB(v) {
  const m = String(v ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}


function formatJB(v) {
  const n = numJB(v);
  return n ? `JB Nº ${n}` : `JB Nº ${String(v || "").toUpperCase()}`;
}

function abrirGoogleMaps(lat, lng) {
  const la = Number(String(lat).replace(",", "."));
  const ln = Number(String(lng).replace(",", "."));
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    alert("❌ GPS inválido.");
    return;
  }

  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid) {
    location.href = `geo:${la},${ln}?q=${la},${ln}`;
    return;
  }

  if (isIOS) {
    location.href = `comgooglemaps://?q=${la},${ln}&center=${la},${ln}&zoom=16`;
    setTimeout(() => {
      window.open(`https://www.google.com/maps?q=${la},${ln}`, "_blank", "noopener,noreferrer");
    }, 400);
    return;
  }

  window.open(`https://www.google.com/maps?q=${la},${ln}`, "_blank", "noopener,noreferrer");
}

function monthStartEnd(ref = new Date()) {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  return {
    start: new Date(y, m, 1, 0, 0, 0, 0),
    end:   new Date(y, m + 1, 0, 23, 59, 59, 999),
  };
}

function parseDataLocalSemTZ(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
}

function abrirAcertosDoEstabelecimentoNoMes(estabKey, jbNum) {
  const U = (v) => String(v || "").trim().toUpperCase();
  const { start, end } = monthStartEnd(new Date());

  const lista = (acertos || []).filter(a => {
    const d = parseDataLocalSemTZ(a.data);
    if (!d || d < start || d > end) return false;
    const aEst = U(a.estab || a.estabelecimento || a.nomeEstabelecimento);
    const aNum = U(a.numero || a.num || a.jb);
    if (estabKey) return aEst === U(estabKey);
    if (jbNum) return aNum === U(jbNum);
    return false;
  });

  try { document.getElementById("__ov_status__")?.remove(); } catch {}

  const ov = document.createElement("div");
  ov.id = "__ov_status__";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:999999;display:flex;align-items:center;justify-content:center;";

  const box = document.createElement("div");
  box.style.cssText = "width:540px;max-width:94%;max-height:88vh;overflow:auto;background:#0f172a;color:#fff;border-radius:14px;padding:16px;box-shadow:0 10px 25px rgba(0,0,0,.35)";

  box.innerHTML = `
    <div style="font-weight:900;font-size:16px;">🏢 ${U(estabKey || "SEM ESTAB")}</div>
    <div style="opacity:.85;font-size:13px;margin:6px 0 12px 0;">${jbNum ? ("JB: " + U(jbNum)) : ""}</div>
    <div style="opacity:.85;font-size:12px;margin-bottom:12px;">
      📅 Mês atual: ${start.toLocaleDateString("pt-BR")} até ${end.toLocaleDateString("pt-BR")}
    </div>

    <div style="background:#111827;border-radius:12px;padding:12px;margin-bottom:12px;">
      ✅ <b>Qtd de acertos no mês:</b> ${lista.length}
    </div>

    <div id="__ov_status_lista__"></div>

    <button type="button" style="width:100%;margin-top:12px;padding:12px;border:none;border-radius:10px;font-weight:900;cursor:pointer;background:#334155;color:#fff;">
      Fechar
    </button>
  `;

  const listEl = box.querySelector("#__ov_status_lista__");

  if (!lista.length) {
    listEl.innerHTML = `<div style="opacity:.9;">❌ Nenhum acerto no mês.</div>`;
  } else {
    listEl.innerHTML = lista
      .slice()
      .sort((a,b)=> new Date(b.data) - new Date(a.data))
      .map(a=>{
        const d = new Date(a.data);
        const empresa = Number(a.empresa || 0);
        const pix = Number(a.pix || 0);
        const esp = Number(a.dinheiro || a.especie || 0);
        return `
          <div style="background:#0b1220;padding:10px;border-radius:12px;margin:8px 0;">
            <div style="font-weight:900;">📌 ${d.toLocaleDateString("pt-BR")}</div>
            <div style="opacity:.9;font-size:13px;">
              🏢 Empresa: R$ ${empresa.toFixed(2)}<br>
              💳 PIX: R$ ${pix.toFixed(2)}<br>
              💵 Espécie: R$ ${esp.toFixed(2)}
            </div>
          </div>
        `;
      }).join("");
  }

  box.querySelector("button").onclick = () => ov.remove();

  ov.appendChild(box);
  document.body.appendChild(ov);

  ov.addEventListener("click", () => ov.remove());
  box.addEventListener("click", (e) => e.stopPropagation());
}



function atualizarStatus() {
  const listaStatus = document.getElementById("listaStatus");
  if (!listaStatus) return;

  listaStatus.innerHTML = "";

  if (!Array.isArray(maquinas)) {
    listaStatus.innerHTML = "<li>⏳ Carregando máquinas...</li>";
    return;
  }

  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  // 🔥 resumo topo (2 cards) - mantém
  let resumo = document.getElementById("resumoStatusTopo");
  if (!resumo) {
    resumo = document.createElement("div");
    resumo.id = "resumoStatusTopo";
    resumo.style.display = "flex";
    resumo.style.gap = "12px";
    resumo.style.margin = "12px 0 16px 0";

    resumo.innerHTML = `
      <div style="flex:1; background:#0f172a; padding:14px; border-radius:12px;">
        <div style="font-weight:900; color:#22c55e;">🟢 ACERTADAS (MÊS)</div>
        <div id="qtdStatusVerde" style="font-size:32px; font-weight:900; margin-top:6px;">0</div>
      </div>

      <div style="flex:1; background:#0f172a; padding:14px; border-radius:12px;">
        <div style="font-weight:900; color:#ef4444;">🔴 NÃO PASSOU (MÊS)</div>
        <div id="qtdStatusVermelha" style="font-size:32px; font-weight:900; margin-top:6px;">0</div>
      </div>
    `;

    listaStatus.parentElement.insertBefore(resumo, listaStatus);
  }

  // ✅ tira depósito
  const ativas = (maquinas || []).filter(m => {
    const st = String(m.status || "").toUpperCase();
    return !st.includes("DEP");
  });

  // 1 por estabelecimento
  const unicos = new Map();
  ativas.forEach(m => {
    const key = String(m.estab || "").toUpperCase().trim();
    if (!key) return;
    if (!unicos.has(key)) unicos.set(key, m);
  });

  const lista = [...unicos.values()];
  lista.sort((a, b) => numJB(a.numero) - numJB(b.numero));

  if (!lista.length) {
  const elV = document.getElementById("qtdStatusVerde");
  const elR = document.getElementById("qtdStatusVermelha");
  if (elV) elV.textContent = "0";
  if (elR) elR.textContent = "0";

  listaStatus.innerHTML = "<li>✅ Nenhuma máquina ativa para mostrar.</li>";
  return;
}

  let totalVerdes = 0;

  lista.forEach((m) => {
    const estabKey = String(m.estab || "").toUpperCase().trim();

    const teveAcerto = (acertos || []).some((a) => {
      const d = new Date(a.data);
      return (
        String(a.estab || "").toUpperCase().trim() === estabKey &&
        d.getMonth() === mesAtual &&
        d.getFullYear() === anoAtual
      );
    });

    if (teveAcerto) totalVerdes++;

    const lat = m.lat ?? m.latitude ?? null;
    const lng = m.lng ?? m.longitude ?? null;
    const temGPS = lat != null && lng != null && String(lat) !== "" && String(lng) !== "";

    const li = document.createElement("li");
    li.style.position = "relative";
    li.style.borderRadius = "12px";
    li.style.background = "#0f172a";
    li.style.cursor = "pointer";
    li.style.marginBottom = "10px";
    li.style.padding = "14px 44px 14px 14px";

    // ✅ clique no card = abrir acertos do mês
    li.addEventListener("click", () => {
      abrirAcertosDoEstabelecimentoNoMes(estabKey, m.numero);
    });

    const linha = document.createElement("div");
    linha.style.display = "flex";
    linha.style.alignItems = "center";
    linha.style.gap = "10px";

    const bol = document.createElement("span");
    bol.textContent = teveAcerto ? "🟢" : "🔴";

    const nome = document.createElement("span");
    nome.textContent = estabKey;
    nome.style.fontWeight = "900";
    nome.style.flex = "1";

    const jb = document.createElement("span");
    jb.textContent = formatJB(m.numero);
    jb.style.fontWeight = "800";

    linha.appendChild(bol);
    linha.appendChild(nome);
    linha.appendChild(jb);
    li.appendChild(linha);

    // ✅ pirulito maps (SEM círculo azul)
    if (temGPS) {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = "📍";
      pin.title = "Abrir no Google Maps";

      // posição
      pin.style.position = "absolute";
      pin.style.right = "10px";
      pin.style.top = "50%";
      pin.style.transform = "translateY(-50%)";

      // ✅ remove círculo/fundo
      pin.style.background = "transparent";
      pin.style.border = "none";
      pin.style.padding = "0";
      pin.style.margin = "0";
      pin.style.width = "auto";
      pin.style.height = "auto";
      pin.style.borderRadius = "0";

      // aparência
      pin.style.cursor = "pointer";
      pin.style.fontSize = "20px";
      pin.style.lineHeight = "1";
      pin.style.filter = "drop-shadow(0 1px 1px rgba(0,0,0,.5))"; // opcional

      pin.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation(); // não dispara o clique do card
        abrirGoogleMaps(lat, lng);
      });

      li.appendChild(pin);
    }

    listaStatus.appendChild(li);
  });

  const totalLista = lista.length;
  const totalVermelhas = totalLista - totalVerdes;

  const elV = document.getElementById("qtdStatusVerde");
  const elR = document.getElementById("qtdStatusVermelha");
  if (elV) elV.textContent = totalVerdes;
  if (elR) elR.textContent = totalVermelhas;
}



// salvar crédito remoto: soma no relógio anterior (ultimoRelogio)
async function salvarCreditoRemoto() {
  if (!exigirAdmin()) return;

  const num = (document.getElementById("crNum")?.value || "").trim().toUpperCase();
  const valor = Number(document.getElementById("crValor")?.value || 0);

  if (!num) return alert("❌ Digite o número da máquina.");
  if (!valor || valor <= 0) return alert("❌ Digite um valor válido (maior que 0).");

  const m = maquinas.find(x => String(x.numero || "").toUpperCase() === num);
  if (!m) return alert("❌ Máquina não encontrada.");

  const atual = m.ultimoRelogio != null ? Number(m.ultimoRelogio) : 0;
  const novo = atual + valor;

  m.ultimoRelogio = novo;

  if (!Array.isArray(m.creditosRemotos)) m.creditosRemotos = [];
  m.creditosRemotos.push({
    id: Date.now(),
    valor,
    antes: atual,
    depois: novo,
    data: new Date().toISOString(),
  });

  const ok = await salvarNoFirebase(true);
  if (!ok) return;

  alert(`✅ Crédito remoto lançado!\n\n${m.estab}\nJB Nº ${m.numero}\n\nRelógio: ${atual.toFixed(2)} → ${novo.toFixed(2)}`);

  // limpar campos
  const crNum = document.getElementById("crNum");
  const crEstab = document.getElementById("crEstab");
  const crValor = document.getElementById("crValor");
  const crInfo = document.getElementById("crInfo");

  if (crNum) crNum.value = "";
  if (crEstab) crEstab.value = "";
  if (crValor) crValor.value = "";
  if (crInfo) crInfo.textContent = "";
}


function definirEmpresa(){
  if (!exigirAdmin()) return;

  const nome = prompt("Nome/ID da empresa (ex: EMPRESA_PRINCIPAL_ID, EMPRESA2, etc):");
  if (!nome) return;

  const empresaId = String(nome).trim().toUpperCase();

  const hid = document.getElementById("empresaIdAtual");
  if (hid) hid.value = empresaId;

  pararSnapshotAtual(); // ✅ AQUI

  setEmpresaAtual(empresaId);

  firebasePronto = false;

  desabilitarBotaoLogin();
  iniciarSincronizacaoFirebase();

  getNomeBonitoEmpresa(empresaId).then((nome) => {
  alert("✅ Empresa selecionada: " + (nome || empresaId));
});

}


function garantirIconeOcorrencias() {
  const b = document.getElementById("btnOcorrencias");
  if (!b) return;

  // se já tem o ícone, não mexe
  if (b.querySelector(".ico-ocorr")) return;

  const ico = document.createElement("span");
  ico.className = "ico-ocorr";
  ico.textContent = "🛠 ";
  ico.style.marginRight = "6px";

  // coloca antes do texto (sem mexer no texto que pisca)
  b.insertBefore(ico, b.firstChild);
}

function blindarIconeOcorrencias() {
  // roda agora
  garantirIconeOcorrencias();

  // evita duplicar observer
  if (window.__obsIconeOcorrencias) return;

  window.__obsIconeOcorrencias = new MutationObserver(() => {
    garantirIconeOcorrencias();
  });

  window.__obsIconeOcorrencias.observe(document.body, {
    childList: true,
    subtree: true,
  });
}


function desabilitarBotaoLogin() {
  const btn = document.getElementById("btnEntrar");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "⏳ carregando...";
  btn.style.opacity = "0.7";
}

function habilitarBotaoLogin() {
  const btn = document.getElementById("btnEntrar");
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = "entrar";
  btn.style.opacity = "1";
}



let carregandoDoFirebase = false;
let __rotinaRodouPorEmpresa = {}; // { "EMPRESA_PRINCIPAL_ID": true, ... }

function rodarRotinasApenasUmaVezPorEmpresa() {
  const emp = String(empresaAtualId || EMPRESA_PRINCIPAL_ID).toUpperCase();

  // já rodou pra essa empresa? então não faz nada
  if (__rotinaRodouPorEmpresa[emp]) return;
  __rotinaRodouPorEmpresa[emp] = true;

  
}



let __avisouQuota = false;

let __cacheEmpresaData = new Map(); // empId -> { data, at }
let __cacheTTLms = 60 * 1000;       // 60s de cache

let __saveTimer = null;
let __saving = false;
let __queued = false;
let __backoffMs = 0;
let __lastCoreStr = "";
let __pauseSaveUntil = 0;
let __lastQuotaWarnAt = 0;


async function compressImageToJpegBlob(file, {
  maxW = 1280,
  maxH = 1280,
  quality = 0.6
} = {}) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

  let w = img.width, h = img.height;
  const ratio = Math.min(maxW / w, maxH / h, 1);
  w = Math.round(w * ratio);
  h = Math.round(h * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));

  URL.revokeObjectURL(img.src);
  return blob; // pronto pra upload
}


async function uploadFotoEGravarUrl({ db, empresaId, file }) {
  await ensureAuth();

  // usa o storage global já criado
  // const storage = getStorage(app);  ❌ remove isso

  const blob = await compressImageToJpegBlob(file, { maxW: 1280, maxH: 1280, quality: 0.6 });

  empresaId = String(empresaId || "").trim().toUpperCase();
  const path = `empresas/${empresaId}/fotos/app_${Date.now()}.jpg`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(storageRef);

  const docRef2 = doc(db, "empresas", empresaId, "dados", "app");
  await setDoc(docRef2, { photoURL: url, photoPath: path, photoUpdatedAt: serverTimestamp() }, { merge: true });

  return url;
}


// ✅ FILA GLOBAL DE SALVAMENTO (não precisa mudar o resto do código)
let __saveQueue = Promise.resolve();

async function salvarNoFirebase(force = false) {
  try {
    await ensureAuth();
    await garantirDocExiste();

    if (!docRef) {
      console.error("❌ docRef não existe (setEmpresaAtual/garantirDocExiste).");
      alert("❌ Banco não pronto (docRef).");
      return false;
    }

    // ✅ GARANTE empresaPerfil OBJETO
    if (!empresaPerfil || typeof empresaPerfil !== "object") empresaPerfil = {};

    // ✅ GARANTE ARRAY (e evita pegar elemento do DOM por acidente)
    const safeMaquinas = Array.isArray(maquinas)
      ? maquinas.map((m) => {
          const mm = normalizarGPSMaquina(m);

          // ✅ NÃO deixar base64 ir pro Firestore
          // (se tiver foto, mantém só URL/path)
          if (mm && typeof mm === "object") {
            delete mm.foto;       // base64
            delete mm.fotoBase64; // caso exista algum nome antigo
          }

          return mm;
        })
      : [];

    const safeUsuarios    = Array.isArray(usuarios)    ? usuarios    : [];
    const safeAcertos     = Array.isArray(acertos)     ? acertos     : [];
    const safeOcorrencias = Array.isArray(ocorrencias) ? ocorrencias : [];

    const payload = {
      atualizadoEm: new Date().toISOString(),
      maquinas: safeMaquinas,
      usuarios: safeUsuarios,
      acertos: safeAcertos,
      ocorrencias: safeOcorrencias,

      // ✅ perfil da empresa (onde fica o bloqueio manual também)
      // exemplo:
      // empresaPerfil.manualBlocked = true/false
      // empresaPerfil.manualBlockedAt = "2026-02-22T..."
      // empresaPerfil.manualBlockedReason = "..."
      empresaPerfil: empresaPerfil,
    };

    // ✅ salva com merge
    await setDoc(docRef, payload, { merge: true });

    console.log("✅ SALVO no Firestore (docRef)");
    return true;

  } catch (e) {
    console.error("❌ ERRO AO SALVAR (Firestore):", e);

    if (typeof isQuotaErr === "function" && isQuotaErr(e)) {
      try { entrarModoOfflinePorQuota(e); } catch {}
      return false;
    }

    alert("❌ Não salvou no Firebase. Veja o Console (F12).");
    return false;
  }
}



window.masterBloquearEmpresa = async function (empresaId, motivo = "") {
  if (!exigirMaster()) return false;

  const emp = String(empresaId || "").trim().toUpperCase();
  if (!emp) {
    alert("❌ Empresa inválida.");
    return false;
  }

  await ensureAuth();

  const ref = doc(db, "empresas", emp, "dados", "app");
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() || {}) : {};

  const perfil = (data.empresaPerfil && typeof data.empresaPerfil === "object") ? data.empresaPerfil : {};

  perfil.manualBlocked = true;
  perfil.manualBlockedAt = new Date().toISOString();
  perfil.manualBlockedReason = String(motivo || "").trim() || "bloqueio manual";

  await setDoc(ref, { empresaPerfil: perfil }, { merge: true });

  alert("✅ Empresa BLOQUEADA: " + emp);
  return true;
};

window.masterDesbloquearEmpresa = async function (empresaId) {
  if (!exigirMaster()) return false;

  const emp = String(empresaId || "").trim().toUpperCase();
  if (!emp) {
    alert("❌ Empresa inválida.");
    return false;
  }

  await ensureAuth();

  const ref = doc(db, "empresas", emp, "dados", "app");
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() || {}) : {};

  const perfil = (data.empresaPerfil && typeof data.empresaPerfil === "object") ? data.empresaPerfil : {};

  perfil.manualBlocked = false;
  perfil.manualBlockedAt = null;
  perfil.manualBlockedReason = null;

  await setDoc(ref, { empresaPerfil: perfil }, { merge: true });

  alert("✅ Empresa DESBLOQUEADA: " + emp);
  return true;
};

async function carregarDadosUmaVezParaLogin() {
  console.log("🔎 carregarDadosUmaVezParaLogin() começou");

  try {
    await ensureAuth();
  } catch (e) {}

  await garantirDocExiste();

  if (!docRef) {
    console.error("❌ docRef não existe em carregarDadosUmaVezParaLogin()");
    return;
  }

  const snap = await getDoc(docRef);
  const data = snap.exists() ? (snap.data() || {}) : {};

  // ✅ SEMPRE sobrescreve (nunca mantém antigo)
  aplicarDadosDoFirestore(data);

  firebasePronto = true;

  console.log("✅ carregarDadosUmaVezParaLogin() terminou OK");

  // atualiza telas
  try { listarMaquinas(); } catch {}
  try { atualizarStatus(); } catch {}
  try { listarOcorrencias(); } catch {}
  try { atualizarAlertaOcorrencias(); } catch {}
}


async function iniciarSincronizacaoFirebase() {
  if (__firestoreBloqueado) return;
  if (__syncIniciando) return;
  __syncIniciando = true;

  try {
    await ensureAuth();
    await garantirDocExiste();

    if (!docRef) {
      console.error("❌ docRef não existe (iniciarSincronizacaoFirebase).");
      __syncIniciando = false;
      return;
    }

    // evita duplicar snapshot
    pararSnapshotAtual();

    unsubSnapshot = onSnapshot(
      docRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() || {}) : {};

        // ✅ SEMPRE sobrescreve com dados da empresa atual
        aplicarDadosDoFirestore(data);

        firebasePronto = true;

        // ✅ atualiza UI
        try { listarMaquinas(); } catch {}
        try { atualizarStatus(); } catch {}
        try { listarOcorrencias(); } catch {}
        try { atualizarAlertaOcorrencias(); } catch {}
      },
      (err) => {
        console.error("❌ onSnapshot erro:", err);

        if (typeof isQuotaErr === "function" && isQuotaErr(err)) {
          entrarModoOfflinePorQuota(err);
        }
      }
    );

    __syncAtivo = true;
  } catch (e) {
    console.error("❌ erro iniciarSincronizacaoFirebase:", e);
  } finally {
    __syncIniciando = false;
  }
}

// -------- File -> Base64 comprimido --------
function reduzirImagemParaBase64(file, opt) {
  const { maxW = 900, maxH = 900, qualidade = 0.75, tipo = "image/jpeg" } = (opt || {});

  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Falha ao ler arquivo"));

    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Falha ao abrir imagem"));

      img.onload = () => {
        let w = img.width;
        let h = img.height;

        // ✅ mantém proporção
        const ratio = Math.min(maxW / w, maxH / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return reject(new Error("Canvas não suportado"));

        ctx.drawImage(img, 0, 0, w, h);

        const base64 = canvas.toDataURL(tipo, qualidade);
        resolve(base64);
      };

      img.src = String(fr.result || "");
    };

    fr.readAsDataURL(file);
  });
}


function abrirFotoMaquina(numero) {
  const num = String(numero || maquinaSelecionadaNumero || "").trim().toUpperCase();
  const m = (maquinas || []).find(x => String(x.numero || "").toUpperCase() === num);

  const src = (m && (m.fotoUrl || m.foto)) || "";
  if (!src) return alert("❌ Essa máquina não tem foto.");

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.85)";
  overlay.style.zIndex = "99999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "16px";

  overlay.innerHTML = `
    <div style="width:100%; max-width:920px; text-align:center;">
      <img src="${src}"
        style="max-width:100%; max-height:82vh; border-radius:16px; object-fit:contain; background:#111;">
      <div style="margin-top:12px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button id="btnFecharFoto"
          style="padding:12px 14px; border:none; border-radius:12px; font-weight:800; cursor:pointer;">
          Fechar
        </button>
      </div>
      <div style="margin-top:10px; color:#fff; font-weight:800;">
        ${String(m.estab || "").toUpperCase()} (JB Nº ${String(m.numero || "").toUpperCase()})
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector("#btnFecharFoto").onclick = () => overlay.remove();
}

window.abrirFotoMaquina = abrirFotoMaquina;

function abrirCreditosRemotos() {
  if (!exigirAdmin()) return; // ✅ COLAB não entra
  abrir("creditosRemotos");   // ✅ abre a tela
}
window.abrirCreditosRemotos = abrirCreditosRemotos;



  function salvarSessao(u) {
  const tipo = String(u.tipo || "").toUpperCase();

  sessaoUsuario = {
    tipo,
    nome: u.nome,
    user: u.user,
    empresaId: (tipo === "MASTER" ? EMPRESA_PRINCIPAL_ID : (u.empresaId || null)),
    criadoEm: Date.now()
  };

  // ✅ deixa global (para o menu / body class / permissões enxergarem)
  window.sessaoUsuario = sessaoUsuario;
  window.__sessao = sessaoUsuario;
}

window.trocarCredenciaisMaster = async function () {
  try {
    if (!exigirMaster()) return;

    // MASTER é sempre na empresa principal
    const empId = EMPRESA_PRINCIPAL;

    const novoUser = prompt("Digite o NOVO usuário do MASTER (login):", "strondamusic");
    if (novoUser === null) return;

    const userLimpo = String(novoUser || "").trim().toLowerCase();
    if (!userLimpo) return alert("❌ Usuário não pode ficar vazio.");

    const novaSenha = prompt("Digite a NOVA senha do MASTER (mín. 4):");
    if (novaSenha === null) return;

    const senhaLimpa = String(novaSenha || "").trim();
    if (senhaLimpa.length < 4) return alert("❌ Senha muito curta.");

    const confirma = prompt("Confirme a NOVA senha do MASTER:");
    if (confirma === null) return;

    if (String(confirma).trim() !== senhaLimpa) {
      return alert("❌ Confirmação não bate.");
    }

    // garante que está na empresa EMPRESA_PRINCIPAL_ID carregada
    pararSnapshotAtual();
    setEmpresaAtual(empId);
    await carregarDadosUmaVezParaLogin();

    // acha o usuário MASTER no doc
    const idx = (usuarios || []).findIndex(u => String(u.tipo || "").toUpperCase() === "MASTER");
    if (idx === -1) return alert("❌ MASTER não encontrado no banco.");

    // atualiza os dados
    usuarios[idx].user = userLimpo;
    usuarios[idx].senha = senhaLimpa;

    // salva no doc da empresa
    await salvarNoFirebase(true);

    // salva no índice central
    await salvarLoginIndex({
      user: userLimpo,
      tipo: "MASTER",
      empresaId: EMPRESA_PRINCIPAL,
      senha: senhaLimpa
    });

    alert("✅ Credenciais do MASTER atualizadas com sucesso!\n\n⚠️ Faça login novamente com o novo usuário/senha.");

    // desloga
    sair();

  } catch (e) {
    console.error(e);
    alert("❌ Falha ao trocar credenciais do MASTER.\n\n" + (e?.message || e));
  }
};


function isLogado() {
  console.log("Sessão do usuário:", sessaoUsuario);  // Log de depuração
  return !!sessaoUsuario;
}


function exigirAdmin() {
  if (!isLogado()) {
    alert("❌ Faça login primeiro.");
    mostrarTelaLogin();
    limparCamposLogin();
    return false;
  }
  if (typeof isAdmin === "function" && !isAdmin()) {
    alert("❌ Somente ADMIN/MASTER.");
    return false;
  }
  return true;
}


function aplicarPermissoesMenu() {
  // ✅ ainda não logou? não mexe no menu
  if (!window.sessaoUsuario) return;

  const btn = document.getElementById("btnCadastrarMaquina");
  if (!btn) return;

  // ✅ colaborador: esconde
  if (window.isColab && window.isColab()) {
    btn.style.display = "none";
    return;
  }

  // ✅ admin/master: mostra
  btn.style.display = "";
}


function exigirMaster() {
  if (!isLogado()) {
    alert("❌ Faça login primeiro.");
    mostrarTelaLogin();
    limparCamposLogin();
    return false;
  }
  if (!isMaster()) {
    alert("❌ Apenas o MASTER pode acessar isso.");
    return false;
  }
  return true;
}



// =====================
// ✅ TELAS: LOGIN / APP
// =====================
function mostrarTelaLogin() {
  const telaLogin = document.getElementById("telaLogin");
  const app = document.getElementById("app");

  if (telaLogin) {
    telaLogin.classList.remove("escondido");
    telaLogin.style.display = "block";
  }
  if (app) {
    app.classList.add("escondido");
    app.style.display = "none";
  }

  // ✅ MUITO IMPORTANTE: quando volta pro login, destrava o botão entrar
  try { habilitarBotaoLogin(); } catch {}

  window.scrollTo(0, 0);
}



function mostrarApp() {
  const telaLogin = document.getElementById("telaLogin");
  const app = document.getElementById("app");
  const menu = document.getElementById("menu");

  if (telaLogin) {
    telaLogin.classList.add("escondido");
    telaLogin.style.display = "none";
  }
  if (app) {
    app.classList.remove("escondido");
    app.style.display = "block";
  }

  // mostra só o menu primeiro
  if (menu) menu.style.display = "flex";

  // esconde TODAS as telas internas do app
  document.querySelectorAll("#app .box").forEach(b => b.classList.add("escondido"));

  window.scrollTo(0, 0);
}

window.mostrarTelaLogin = mostrarTelaLogin;

// =====================
// 🔒 PERMISSÕES (ADMIN x COLAB)
// =====================
function aplicarPermissoesUI() {
  const rAnt = document.getElementById("relogioAnterior");
  if (!rAnt) return;

  if (!isAdmin()) {
    rAnt.disabled = true;
    rAnt.style.opacity = "0.6";
    rAnt.style.cursor = "not-allowed";
    rAnt.title = "Somente ADMIN pode alterar o Relógio Anterior";

    rAnt.onclick = () => alert("❌ Somente o ADMIN pode alterar o Relógio Anterior.");
  } else {
    rAnt.disabled = false;
    rAnt.style.opacity = "1";
    rAnt.style.cursor = "text";
    rAnt.title = "";
    rAnt.onclick = null;
  }
}

function esconderBotaoCadastrarMaquina() {
  if (typeof isAdmin !== "function" || !isAdmin()) return;


  // botão do menu (principal)
  const btnMenu = document.getElementById("btnCadastrarMaquina");
  if (btnMenu) btnMenu.style.display = "none";

  // se existir algum botão de cadastrar máquina DENTRO da tela de colaboradores
  const btnDentro = document.querySelector("#colaboradores #btnCadastrarMaquina, #colaboradores .btnCadastrarMaquina");
  if (btnDentro) btnDentro.style.display = "none";
}

// ============================
// ✅ FOTO: cache local + Storage + Firestore (via salvarNoFirebase)
// ============================
const FOTO_QUALITY = 0.55;
const FOTO_MAX_W = 720;
const FOTO_MAX_H = 720;
const LS_FOTOS_KEY = "fotos_maquinas_cache_v1";

// -------- LocalStorage (navegador) --------
function lerCacheFotos() {
  try { return JSON.parse(localStorage.getItem(LS_FOTOS_KEY) || "{}"); }
  catch { return {}; }
}
function salvarCacheFotos(obj) {
  localStorage.setItem(LS_FOTOS_KEY, JSON.stringify(obj || {}));
}
function salvarFotoNoNavegador(numero, base64, extra = {}) {
  const cache = lerCacheFotos();
  const key = String(numero || "").toUpperCase().trim();
  cache[key] = { base64, updatedAt: Date.now(), ...extra };
  salvarCacheFotos(cache);
}
function removerFotoDoNavegador(numero) {
  const cache = lerCacheFotos();
  delete cache[String(numero || "").toUpperCase().trim()];
  salvarCacheFotos(cache);
}


function aplicarFotosDoNavegadorNasMaquinas() {
  const cache = lerCacheFotos();

  (maquinas || []).forEach((m) => {
    const key = String(m.numero || "").toUpperCase().trim();
    const c = cache[key];
    if (!c) return;

    // ✅ prioridade SEMPRE do Firebase (fotoUrl)
    // só usa o base64 do cache como fallback (quando não existe fotoUrl)
    if (!m.fotoUrl && c.base64) {
      m.foto = c.base64;
    }

    // ✅ não sobrescreve fotoUrl vindo do Firebase
    if (!m.fotoUrl && c.fotoUrl) m.fotoUrl = c.fotoUrl;

    // mantém fotoPath só se não existir
    if (!m.fotoPath && c.fotoPath) m.fotoPath = c.fotoPath;
  });
}




function base64ToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function uploadFotoParaStorage({ empresaId, numeroMaquina, blob }) {
  const emp = String(empresaId || EMPRESA_PRINCIPAL_ID || "EMP").toUpperCase();
  const num = String(numeroMaquina || "").toUpperCase().trim();

  const path = `empresas/${emp}/maquinas/${num}/foto_${Date.now()}.jpg`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, blob, {
    contentType: blob.type || "image/jpeg",
    cacheControl: "public,max-age=31536000",
  });

  const url = await getDownloadURL(storageRef);
  return { url, path };
}


// -------- FUNÇÃO PRINCIPAL --------
async function escolherFotoMaquina(numero) {
  const num = String(numero || maquinaSelecionadaNumero || "").trim().toUpperCase();
  if (!num) return alert("❌ Máquina não encontrada.");

  const m = (maquinas || []).find(x => String(x.numero || "").toUpperCase() === num);
  if (!m) return alert("❌ Máquina não encontrada.");

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.setAttribute("capture", "environment");

  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => abrirTelaRecorte(reader.result, m, num);
    reader.readAsDataURL(file);
  };

  input.click();
}

function abrirTelaRecorte(src, maquina, num) {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.95)";
  overlay.style.zIndex = "99999";
  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";

  overlay.innerHTML = `
    <div style="flex:1; min-height:0; display:flex; align-items:center; justify-content:center; background:#111;">
      <img id="imgCrop" src="${src}" style="max-width:100%; max-height:100%; display:block;">
    </div>

    <div style="padding:12px; background:#000; display:flex; flex-direction:column; gap:10px;">
      <div style="display:flex; gap:10px;">
        <button id="btnCortar" style="flex:1;padding:14px;border-radius:10px;font-weight:800;cursor:pointer;">
          Salvar Foto
        </button>
        <button id="btnCancelarCrop" style="flex:1;padding:14px;border-radius:10px;cursor:pointer;">
          Cancelar
        </button>
      </div>

      <div style="color:#fff; opacity:.8; font-weight:700; text-align:center;">
        Arraste a imagem e ajuste as bordas do recorte
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const image = overlay.querySelector("#imgCrop");
  const btnSalvar = overlay.querySelector("#btnCortar");
  const btnCancelar = overlay.querySelector("#btnCancelarCrop");

  let cropper = null;

  function fechar() {
    try { cropper?.destroy?.(); } catch {}
    cropper = null;
    overlay.remove();
  }

  btnCancelar.onclick = fechar;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) fechar();
  });

  if (!window.Cropper) {
    alert("❌ Cropper não carregou.");
    return fechar();
  }

  btnSalvar.disabled = true;
  btnSalvar.style.opacity = "0.6";

  image.onload = () => {
    try {
      cropper = new window.Cropper(image, {
        viewMode: 1,
        autoCropArea: 1,
        responsive: true,
        background: false,
        modal: true,
        guides: true,

        // 👇 ESSAS 3 LINHAS SÃO O SEGREDO DO COMPORTAMENTO QUE VOCÊ QUER
        dragMode: "move",
        cropBoxMovable: true,
        cropBoxResizable: true,

        // livre (não prende quadrado)
        aspectRatio: NaN,

        minCropBoxWidth: 80,
        minCropBoxHeight: 80,
      });

      setTimeout(() => {
        try { cropper.resize(); } catch {}
      }, 50);

      btnSalvar.disabled = false;
      btnSalvar.style.opacity = "1";
    } catch (e) {
      console.error(e);
      alert("❌ Falha ao iniciar o recorte.");
      fechar();
    }
  };

  btnSalvar.onclick = async () => {
    if (!cropper) return;

    btnSalvar.disabled = true;
    btnSalvar.style.opacity = "0.7";

    try {
      const canvas = cropper.getCroppedCanvas({
        width: 800,
        height: 800
      });

      const base64 = canvas.toDataURL("image/jpeg", 0.7);

      maquina.foto = base64;
      salvarFotoNoNavegador(num, base64);

      try {
        const blob = base64ToBlob(base64);
        const up = await uploadFotoParaStorage({
          empresaId: empresaAtualId,
          numeroMaquina: num,
          blob
        });

        maquina.fotoUrl = up.url;
maquina.fotoPath = up.path;
maquina.fotoUpdatedAt = new Date().toISOString();

// ✅ atualiza cache local também com a url/path
salvarFotoNoNavegador(num, base64, { fotoUrl: up.url, fotoPath: up.path });

await salvarNoFirebase(true);

        alert("✅ Foto salva!");
      } catch (e) {
        console.error(e);
        alert("✅ Foto salva só no aparelho.");
      }

      try { listarMaquinas(); } catch {}
      fechar();

    } catch (e) {
      console.error(e);
      alert("❌ Falha ao recortar.");
      btnSalvar.disabled = false;
      btnSalvar.style.opacity = "1";
    }
  };
}


function removerFotoMaquina(numero) {
  const num = String(numero || maquinaSelecionadaNumero || "").trim().toUpperCase();
  const m = (maquinas || []).find(x => String(x.numero || "").toUpperCase() === num);
  if (!m) return alert("❌ Máquina não encontrada.");

  const ok = confirm("Remover a foto dessa máquina?");
  if (!ok) return;

  // remove do preview
  m.foto = null;
  m.fotoUrl = null;
  m.fotoPath = null;
  m.fotoUpdatedAt = new Date().toISOString();

  // remove do navegador
  removerFotoDoNavegador(num);

  // tenta persistir
  try { salvarNoFirebase(true); } catch {}

  try { listarMaquinas(); } catch {}
  try { atualizarStatus(); } catch {}
  alert("✅ Foto removida.");
}

window.escolherFotoMaquina = escolherFotoMaquina;
window.removerFotoMaquina = removerFotoMaquina;
window.aplicarFotosDoNavegadorNasMaquinas = aplicarFotosDoNavegadorNasMaquinas;



async function voltarParaStronda() {
  try {
    pararSnapshotAtual();

    setEmpresaAtual(EMPRESA_PRINCIPAL); // EMPRESA_PRINCIPAL_ID
    localStorage.setItem("empresaAtualId", EMPRESA_PRINCIPAL);

    firebasePronto = false;
    desabilitarBotaoLogin();

    // carrega dados já (não espera snapshot)
    await carregarDadosUmaVezParaLogin();

    // liga snapshot da EMPRESA_PRINCIPAL_ID
    pararSnapshotAtual();
    __syncAtivo = false;
    await iniciarSincronizacaoFirebase();

    // atualiza UI
    mostrarApp();
    aplicarPermissoesUI();
    aplicarPermissoesMenu();
    try { listarMaquinas(); } catch {}
    try { atualizarStatus(); } catch {}
    try { listarOcorrencias(); } catch {}

    alert(`✅ Voltou para ${EMPRESA_PRINCIPAL_NOME}!`);
  } catch (e) {
    console.error(e);
    alert(`❌ Falha ao voltar para ${EMPRESA_PRINCIPAL_NOME}.\n\n` + (e?.message || e));
  }
}
window.voltarParaStronda = voltarParaStronda;


async function entrarLogin(tipo) {
  desabilitarBotaoLogin();

  try {
    try { await ensureAuth(); } catch (e) {}

    tipo = String(tipo || "").toUpperCase();
    if (tipo.includes("ADMIN")) tipo = "ADMIN";
    if (tipo.includes("COLAB")) tipo = "COLAB";

    const user = (document.getElementById("loginUser")?.value || "").trim().toLowerCase();
    const senha = (document.getElementById("loginSenha")?.value || "").trim();

    if (!user || !senha) {
      alert("❌ Preencha usuário e senha.");
      return;
    }

    let info = null;
    try {
      info = await buscarLoginIndex(user);
    } catch (e) {
      console.error("buscarLoginIndex erro:", e);
    }

    if (!info) {
      alert("❌ Usuário não encontrado.");
      return;
    }

    const tipoReal = String(info.tipo || "").toUpperCase();
    const empresaDoUser = String(info.empresaId || "").toUpperCase();
    const senhaReal = String(info.senha || "");

    if (senhaReal !== senha) {
      alert("❌ Login inválido.");
      return;
    }

    if (tipo === "ADMIN" && !(tipoReal === "ADMIN" || tipoReal === "MASTER")) {
      alert("❌ Esse usuário não é ADMIN.");
      return;
    }
    if (tipo === "COLAB" && tipoReal !== "COLAB") {
      alert("❌ Esse usuário não é COLAB.");
      return;
    }

    pararSnapshotAtual();

    if (tipoReal === "MASTER") {
      setEmpresaAtual(EMPRESA_PRINCIPAL);
    } else {
      setEmpresaAtual(empresaDoUser);
    }

    firebasePronto = false;

    // carrega dados da empresa atual (não trava mais)
    await carregarDadosUmaVezParaLogin();

    // BLOQUEIO MANUAL (master ignora)
    if (tipoReal !== "MASTER") {
      const bloqueada =
        (typeof empresaEstaBloqueada === "function")
          ? empresaEstaBloqueada(empresaPerfil)
          : (empresaPerfil && empresaPerfil.manualBlocked === true);

      if (bloqueada) {
        const msg =
          (typeof motivoBloqueioEmpresa === "function")
            ? motivoBloqueioEmpresa(empresaPerfil)
            : (empresaPerfil?.manualBlockedReason || "empresa bloqueada manualmente");

        alert("⛔ ACESSO BLOQUEADO\n\n" + msg);

        try { limparSessao(); } catch {}
        try { mostrarTelaLogin(); } catch {}
        return;
      }
    }

    const u = (usuarios || []).find(x =>
      String(x.user || "").toLowerCase() === user &&
      String(x.senha || "") === senha &&
      String(x.tipo || "").toUpperCase() === tipoReal
    );

    const userObj = u || {
      tipo: tipoReal,
      nome: String(tipoReal),
      user,
      senha,
      empresaId: (tipoReal === "MASTER" ? EMPRESA_PRINCIPAL : empresaDoUser)
    };

    salvarSessao(userObj);

    aplicarClassePermissaoBody();
    aplicarPermissoesMenu();
    aplicarPermissoesUI();
    aplicarPermissaoBotaoDeposito();
    esconderBotaoCadastrarMaquina();
    ativarProtecaoCadastroMaquina();

    pararSnapshotAtual();
    __syncAtivo = false;
    await iniciarSincronizacaoFirebase();

    if (userObj.tipo === "COLAB") {
      const nomeBonito = await getNomeBonitoEmpresa(userObj.empresaId);
      alert("✅ Entrou na empresa: " + (nomeBonito || userObj.empresaId || "SEM EMPRESA"));
    }

    mostrarApp();
    aplicarPermissoesUI();
    aplicarPermissoesMenu();
    atualizarAlertaOcorrencias();

    // opcional seu
    try { esconderTrocaSenhaMasterForaDaStronda(); } catch {}

  } catch (e) {
    console.error("❌ erro no entrarLogin:", e);
    alert("❌ erro ao entrar. veja o console (F12).");
  } finally {
    // ✅ garante que o botão volta SEMPRE
    habilitarBotaoLogin();
  }
}



// =====================
// ✅ ADMIN: criar colaboradores
// =====================
function adicionarColaborador() {
  if (!exigirAdmin()) return;

  const nome  = (document.getElementById("colabNome")?.value || "").trim().toUpperCase();
  const user  = (document.getElementById("colabUser")?.value || "").trim().toLowerCase();
  const senha = (document.getElementById("colabSenha")?.value || "").trim();
  const whats = (document.getElementById("colabWhats")?.value || "").trim();

  if (!nome || !user || !senha) return alert("❌ Preencha nome, usuário e senha.");

  // ✅ BLOQUEIA USUÁRIO REPETIDO (COLOAB)
  const jaExiste = (usuarios || []).some(u =>
    String(u.tipo).toUpperCase() === "COLAB" &&
    String(u.user).toLowerCase() === user
  );
  if (jaExiste) return alert("⚠️ Já existe colaborador com esse usuário.");

    const empresaId = String(empresaAtualId || "").trim().toUpperCase();
if (!empresaId) return alert("❌ Empresa atual não definida.");

  usuarios.push({
    id: Date.now(),
    tipo: "COLAB",
    nome,
    user,
    senha,
    whats,
    empresaId   // ✅ AQUI
  });


  salvarNoFirebase();
salvarLoginIndex({ user, tipo:"COLAB", empresaId, senha, nome });

  document.getElementById("colabNome").value = "";
  document.getElementById("colabUser").value = "";
  document.getElementById("colabSenha").value = "";
  document.getElementById("colabWhats").value = "";

  listarColaboradores();
  alert("✅ Colaborador criado!");
}

function normalizarWhats(valor) {
  let n = String(valor || "").replace(/\D/g, "");
  if (n.startsWith("55")) n = n.slice(2);      // remove 55 se tiver
  if (n.length > 11) n = n.slice(0, 11);       // limita
  return n.length >= 10 ? n : "";              // valida DDD + num
}

function limparSessao() {
  sessaoUsuario = null;
  localStorage.removeItem("sessaoUsuario");
  window.__sessao = null;
}



function listarColaboradoresComWhats() {
  const empAtual = String(empresaAtualId || "").toUpperCase();

  return (usuarios || [])
    .filter(u =>
      String(u.tipo || "").toUpperCase() === "COLAB" &&
      String(u.empresaId || "").toUpperCase() === empAtual
    )
    .map(u => ({ ...u, whats: normalizarWhats(u.whats) }))
    .filter(u => !!u.whats);
}
 


function abrirWhatsTexto(tel, msg) {
  tel = String(tel || "").replace(/\D/g, "");
  if (!tel) return false;

  // se veio DDD+numero, coloca 55
  if (tel.length === 10 || tel.length === 11) tel = "55" + tel;

  const text = encodeURIComponent(msg || "");

  const isMobile =
    /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);

  // ✅ Celular: wa.me (abre app se tiver)
  const urlMobile = `https://wa.me/${tel}?text=${text}`;

  // ✅ PC: abre WhatsApp Web direto (sem passar pela tela "Abrir app")
  const urlPc = `https://web.whatsapp.com/send?phone=${tel}&text=${text}`;

  const url = isMobile ? urlMobile : urlPc;

  // ✅ abre com "clique real" (melhor contra bloqueio)
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();

  // fallback
  setTimeout(() => { try { window.location.href = url; } catch {} }, 300);

  return true;
}


function aplicarPermissaoBotaoDeposito() {
  const btn = document.getElementById("btnMaquinasDeposito");
  if (!btn) return;

  // ✅ mostra pra todo mundo logado (ADMIN, MASTER e COLAB)
  const logado = !!window.sessaoUsuario;
  btn.style.display = logado ? "block" : "none";
}


function abrirMaquinasDeposito() {
  if (!window.sessaoUsuario) {
    alert("❌ Faça login primeiro.");
    mostrarTelaLogin();
    return;
  }
  window.filtroMaquinas = "DEPOSITO";
  abrir("clientes");
  try { listarMaquinas(); } catch (e) {}
}
window.abrirMaquinasDeposito = abrirMaquinasDeposito;



function abrirWhatsBusiness(tel, msg) {
  tel = String(tel || "").replace(/\D/g, "");
  if (!tel) return false;
  if (tel.length === 10 || tel.length === 11) tel = "55" + tel;

  const text = encodeURIComponent(msg || "");
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // fallback universal
  const waMe = `https://wa.me/${tel}?text=${text}`;

  if (isAndroid) {
    const intentW4B =
      `intent://send?phone=${tel}&text=${text}` +
      `#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end`;
    location.href = intentW4B;
    setTimeout(() => (location.href = waMe), 1200);
    return true;
  }

  if (isIOS) {
    location.href = `whatsapp://send?phone=${tel}&text=${text}`;
    setTimeout(() => (location.href = waMe), 1200);
    return true;
  }

  window.open(waMe, "_blank", "noopener,noreferrer");
  return true;
}

function abrirWhatsNormal(tel, msg) {
  tel = String(tel || "").replace(/\D/g, "");
  if (!tel) return false;
  if (tel.length === 10 || tel.length === 11) tel = "55" + tel;

  const text = encodeURIComponent(msg || "");
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const waMe = `https://wa.me/${tel}?text=${text}`;

  if (isAndroid) {
    const intentWA =
      `intent://send?phone=${tel}&text=${text}` +
      `#Intent;scheme=whatsapp;package=com.whatsapp;end`;
    location.href = intentWA;
    setTimeout(() => (location.href = waMe), 1200);
    return true;
  }

  if (isIOS) {
    location.href = `whatsapp://send?phone=${tel}&text=${text}`;
    setTimeout(() => (location.href = waMe), 1200);
    return true;
  }

  window.open(waMe, "_blank", "noopener,noreferrer");
  return true;
}


function listarColaboradores() {
  if (!exigirAdmin()) return;

  const ul = document.querySelector("#colaboradores #listaColabs") || document.getElementById("listaColabs");

  if (!ul) return;
  ul.innerHTML = "";

  const lista = usuarios.filter(x =>
  String(x.tipo).toUpperCase() === "COLAB" &&
  String(x.empresaId || "").toUpperCase() === String(empresaAtualId || "").toUpperCase()
);


  lista.forEach(c => {
    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "center";
    li.style.gap = "10px";
    li.innerHTML = `<span><b>${c.nome}</b> — user: ${c.user}</span>`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "🗑 Remover";
    btn.onclick = () => {
      if (!confirm("Remover esse colaborador?")) return;
      usuarios = usuarios.filter(x => x.id !== c.id);
      salvarNoFirebase();
      listarColaboradores();
    };

    li.appendChild(btn);
    ul.appendChild(li);
  });
}


const $ = (id) => document.getElementById(id);




// =====================
// ✅ OCORRÊNCIA PÚBLICA (SEM LOGIN)
// =====================
function atualizarPublicoOcorrenciaAuto() {
  const numEl = document.getElementById("pubOcNum");
  const estabEl = document.getElementById("pubOcEstab");
  if (!numEl || !estabEl) return;

  const num = (numEl.value || "").trim().toUpperCase();
  numEl.value = num;

  if (!num) {
    estabEl.value = "";
    return;
  }

  const m = maquinas.find(x => String(x.numero).toUpperCase() === num);
  estabEl.value = m ? String(m.estab || "").toUpperCase() : "❌ MÁQUINA NÃO ENCONTRADA";
}

async function salvarOcorrenciaPublica() {
  const empresa_id = (document.getElementById("pubOcEmpresa")?.value || "").trim().toUpperCase();
  const num = (document.getElementById("pubOcNum")?.value || "").trim().toUpperCase();
  const estab = (document.getElementById("pubOcEstab")?.value || "").trim().toUpperCase();
  const obs = (document.getElementById("pubOcObs")?.value || "").trim();

  if (!empresa_id) return alert("❌ Selecione a empresa.");
  if (!num) return alert("❌ Digite o número da máquina.");
  if (!estab || estab.includes("NÃO ENCONTRADA")) return alert("❌ Máquina não encontrada nessa empresa.");
  if (!obs) return alert("❌ Escreva a observação.");

  try {
    const ref = doc(db, "empresas", empresa_id, "dados", "app");

    const item = {
      id: Date.now(),
      numero: num,
      estab,
      obs,
      data: new Date().toISOString(),
      origem: "CLIENTE"
    };

    // ✅ 1 WRITE só, sem READ do documento inteiro
    await updateDoc(ref, {
      atualizadoEm: new Date().toISOString(),
      ocorrencias: arrayUnion(item)
    });

    document.getElementById("pubOcNum").value = "";
    document.getElementById("pubOcEstab").value = "";
    document.getElementById("pubOcObs").value = "";

    alert("✅ Ocorrência enviada!");
  } catch (e) {
    console.error(e);

    // se doc não existir ainda, cria uma vez
    if (String(e?.code || "").includes("not-found")) {
      try {
        const ref = doc(db, "empresas", empresa_id, "dados", "app");
        await setDoc(ref, {
          atualizadoEm: new Date().toISOString(),
          ocorrencias: [{
            id: Date.now(),
            numero: num,
            estab,
            obs,
            data: new Date().toISOString(),
            origem: "CLIENTE"
          }],
          maquinas: [],
          acertos: [],
          usuarios: []
        });
        alert("✅ Ocorrência enviada!");
        return;
      } catch (e2) {
        console.error(e2);
      }
    }

    if (isQuotaErr(e)) {
      entrarModoOfflinePorQuota(e);
      return;
    }

    alert("❌ Erro ao enviar ocorrência.\n\n" + (e?.message || e));
  }
}


function pegarNumeroJB(valor) {
  const n = parseInt(String(valor || "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}


if (Array.isArray(maquinas)) {
  maquinas.sort((a,b)=> pegarNumeroJB(a.numero)-pegarNumeroJB(b.numero));
}



function _normTxt(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toUpperCase()
    .trim();
}

// ✅ detecta depósito por status OU pelo nome do estab
function ehDeposito(m) {
  const st = String(m?.status || "").trim().toUpperCase();

  // depósito = SOMENTE pelo STATUS
  if (typeof isDepositoStatus === "function") return isDepositoStatus(st);

  return (st === "DEPOSITO" || st === "DEPÓSITO");
}


function esconderCadastroMaquinaParaColab() {
  // admin/master vê
  if (typeof window.isAdmin === "function" && window.isAdmin()) return;

  // ✅ forma mais segura: pelo ID do botão
  const btn = document.getElementById("btnCadastrarMaquina");
  if (btn) btn.style.display = "none";

  // ✅ fallback: se não tiver ID (caso esqueça no HTML), tenta pelo texto
  const menu =
    document.getElementById("menu") ||
    document.getElementById("sidebar") ||
    document.querySelector(".menu") ||
    document.querySelector(".sidebar") ||
    document.body;

  const alvo = _normTxt("CADASTRAR MAQUINA"); // o seu botão é "Cadastrar Máquina"

  const itens = menu.querySelectorAll("button, a, [role='button'], .btn, li, div");
  itens.forEach((el) => {
    const t = _normTxt(el.textContent);
    if (t.includes(alvo)) el.style.display = "none";
  });
}

function ativarProtecaoCadastroMaquina() {
  // ✅ não logou ainda? não mexe no menu
  if (!window.sessaoUsuario) return;

  // ✅ admin/master NÃO precisam dessa proteção
  if (typeof window.isAdmin === "function" && window.isAdmin()) return;

  // ✅ roda 1x agora (somente COLAB)
  try {
    esconderCadastroMaquinaParaColab();
  } catch (e) {
    console.warn("⚠️ esconderCadastroMaquinaParaColab falhou:", e);
  }

  // ✅ evita criar vários observers
  if (window.__obsCadMaq) return;

  // ✅ observa mudanças no DOM e reaplica (somente COLAB)
  window.__obsCadMaq = new MutationObserver(() => {
    // se virou admin depois (troca de sessão), para de aplicar
    if (typeof window.isAdmin === "function" && window.isAdmin()) return;

    try {
      esconderCadastroMaquinaParaColab();
    } catch {}
  });

  window.__obsCadMaq.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function abrir(id) {
  // ✅ BLOQUEIO: cadastro só ADMIN/MASTER
  if (id === "cadastro") {
    if (typeof exigirAdmin === "function" && !exigirAdmin()) return;
  }

  const menu = document.getElementById("menu");

  // 1) esconde o menu
  if (menu) {
    menu.classList.add("escondido");
    menu.style.display = "none";
  }

  // 2) esconde todas as telas internas do app
  document.querySelectorAll("#app .box").forEach(sec => {
    sec.classList.add("escondido");
    sec.style.display = "none";
  });

  // 3) mostra SOMENTE a tela escolhida
  const alvo = document.getElementById(id);
  if (alvo) {
    alvo.classList.remove("escondido");
    alvo.style.display = "block";
  }

  // 4) sobe pro topo
  window.scrollTo({ top: 0, behavior: "auto" });

  // ✅ quando abre COLABORADORES
  if (id === "colaboradores") {
    try { listarColaboradores(); } catch (e) { console.log(e); }
    try { esconderBotaoCadastrarMaquina(); } catch (e) { console.log(e); }
  }

  // ✅ quando abre SELECIONAR EMPRESA
  if (id === "selecionarEmpresa") {
    try { listarEmpresasUI().catch(console.error); } catch (e) { console.log(e); }
  }

  // ✅ quando abre CLIENTS (lista de máquinas)
  if (id === "clients") {
    try { listarMaquinas(); } catch (e) { console.log(e); }
  }
}


function voltar() {
  // ✅ LIMPA filtro quando voltar pro menu (resolve o bug do depósito)
  window.filtroMaquinas = "";
  try { listarMaquinas(); } catch(e) {}

  // esconde todas as telas internas
  document.querySelectorAll("#app .box").forEach(sec => {
    sec.classList.add("escondido");
    sec.style.display = "none";
  });

  // mostra o menu
  const menu = document.getElementById("menu");
  if (menu) {
    menu.classList.remove("escondido");
    menu.style.display = "flex";
  }

  window.scrollTo({ top: 0, behavior: "auto" });
}

function abrirMaquinasCadastradas() {
  window.filtroMaquinas = "CADASTRADAS"; // ✅ exclui depósito
  abrir("clientes");
  try { listarMaquinas(); } catch (e) {}
}
window.abrirMaquinasCadastradas = abrirMaquinasCadastradas;


function normalizarStatus(s) {
  return (s || "ALUGADA")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}



function formatarTelefoneBR(valor) {
  let n = String(valor || "").replace(/\D/g, "");

  // se vier com 55, remove
  if (n.startsWith("55") && n.length >= 12) n = n.slice(2);

  // limita
  if (n.length > 11) n = n.slice(0, 11);

  const ddd = n.slice(0, 2);
  const num = n.slice(2);

  if (n.length <= 2) return n;
  if (n.length <= 6) return `(${ddd}) ${num}`;
  if (n.length === 10) return `(${ddd}) ${num.slice(0,4)}-${num.slice(4)}`;      // fixo
  if (n.length === 11) return `(${ddd}) ${num.slice(0,5)}-${num.slice(5)}`;      // celular

  return `(${ddd}) ${num}`;
}


/* ======================
   CADASTRO DE MÁQUINA (SÓ NÚMERO)
   - Não pode repetir (inclui depósito porque depósito também está em "maquinas")
   - Salva e volta igual os demais
====================== */
async function salvarMaquina() {
  try {
    let numero = ($("numMaquina")?.value || "").trim().toUpperCase();

    if (!numero) {
      alert("❌ Preencha o número da jukebox");
      return;
    }

    // garante array
    window.maquinas = Array.isArray(window.maquinas) ? window.maquinas : [];

    // ✅ NÃO PODE REPETIR (depósito e cadastradas estão juntos aqui)
    const numeroExiste = maquinas.some((m) => String(m.numero).toUpperCase() === numero);
    if (numeroExiste) {
      alert("⚠️ Esse número já existe no Depósito ou em Máquinas cadastradas");
      return;
    }

    // ✅ cria registro mínimo
    const estabDeposito =
      (typeof labelDeposito === "function" ? labelDeposito() : "DEPÓSITO");

    maquinas.push({
      numero,
      estab: estabDeposito,     // fica com nome padrão de depósito
      cliente: "",
      endereco: "",
      porcBase: 0,
      ddd: "",
      tel: "",
      foneFormatado: "",
      lat: null,
      lng: null,
      status: "DEPOSITO",  // ✅ já entra como depósito
      resetStatusAt: null,
    });

    // salva no Firebase (mantém sua lógica)
    const ok = await salvarNoFirebase(true);
    if (!ok) return;

    // atualiza listas se existirem
    try { if (typeof listarMaquinas === "function") listarMaquinas(); } catch {}
    try { if (typeof listarLocaisSalvos === "function") listarLocaisSalvos(); } catch {}

    alert("✅ Número cadastrado com sucesso!");

    // limpa campo
    if ($("numMaquina")) $("numMaquina").value = "";

    // ✅ volta igual os demais
    voltar();
  } catch (e) {
    console.error("❌ Erro em salvarMaquina:", e);
    alert("❌ Não consegui salvar. Veja o Console (F12).");
  }
}


/* ======================
   ACERTO RÁPIDO
====================== */
function acharMaquinaPorCampos() {
  const numero = ($("numAcerto")?.value || "").trim().toUpperCase();
  const estab = ($("estabAcerto")?.value || "").trim().toUpperCase();

  // procura por número ou estab (case-insensitive)
  const maquina =
    maquinas.find((m) => String(m.numero).toUpperCase() === numero) ||
    maquinas.find((m) => String(m.estab).toUpperCase() === estab);

  return maquina || null;
}

// AUTO PELO NÚMERO
function autoPorNumero() {
  const campoNum = $("numAcerto");
  const campoEstab = $("estabAcerto");
  const rAnt = $("relogioAnterior");

  if (!campoNum || !campoEstab) return;

  campoNum.value = campoNum.value.toUpperCase();

  const numeroDigitado = campoNum.value.trim().toUpperCase();
  if (!numeroDigitado) {
    campoEstab.value = "";
    if (rAnt) rAnt.value = "";
    limparPorcentagemAcerto();
    atualizarPreviewAcerto();
    return;
  }

  const maquina = maquinas.find((m) => String(m.numero).toUpperCase() === numeroDigitado);

  if (maquina) {
    campoEstab.value = String(maquina.estab || "").toUpperCase();

    // coloca o último relógio como "anterior"
    if (rAnt) rAnt.value = maquina.ultimoRelogio != null ? String(maquina.ultimoRelogio) : "";

    // ✅ aplica % base (porcBase) no acerto
    percAcertoTravadoPeloUser = false; // ao selecionar máquina, permite auto preencher
    aplicarPorcBaseNoAcerto(maquina);
  } else {
    campoEstab.value = "";
    if (rAnt) rAnt.value = "";
    limparPorcentagemAcerto();
  }

  atualizarPreviewAcerto();
}

// AUTO PELO ESTABELECIMENTO
function autoPorEstab() {
  const campoNum = $("numAcerto");
  const campoEstab = $("estabAcerto");
  const rAnt = $("relogioAnterior");

  if (!campoNum || !campoEstab) return;

  campoEstab.value = campoEstab.value.toUpperCase();

  const estabDigitado = campoEstab.value.trim().toUpperCase();
  if (!estabDigitado) {
    campoNum.value = "";
    if (rAnt) rAnt.value = "";
    limparPorcentagemAcerto();
    atualizarPreviewAcerto();
    return;
  }

  const maquina = maquinas.find((m) => String(m.estab).toUpperCase() === estabDigitado);

  if (maquina) {
    campoNum.value = String(maquina.numero || "").toUpperCase();

    // coloca o último relógio como "anterior"
    if (rAnt) rAnt.value = maquina.ultimoRelogio != null ? String(maquina.ultimoRelogio) : "";

    // ✅ aplica % base (porcBase) no acerto
    percAcertoTravadoPeloUser = false;
    aplicarPorcBaseNoAcerto(maquina);
  } else {
    campoNum.value = "";
    if (rAnt) rAnt.value = "";
    limparPorcentagemAcerto();
  }

  atualizarPreviewAcerto();
}

/* ===== Preview (mostra valores antes de salvar) ===== */
function atualizarPreviewAcerto() {
  const resultado = $("resultado");
  if (!resultado) return;

  const rAnt = Number($("relogioAnterior")?.value || 0);
  const rAtu = Number($("relogioAtual")?.value || 0);

  const pixV = Number($("pix")?.value || 0);
  const dinV = Number($("dinheiro")?.value || 0);
  const perc = Number($("porcentagem")?.value || 0);

  const temRelogio = rAnt > 0 && rAtu > 0;
  const totalRelogio = temRelogio ? arred2(rAtu - rAnt) : 0;

  const totalValores = arred2(pixV + dinV);

  // Total usado no cálculo (se tem relógio, ele manda)
  const total = temRelogio ? totalRelogio : totalValores;

  if (total < 0) {
    resultado.innerHTML = `❌ Relógio Atual não pode ser menor que Relógio Anterior.`;
    return;
  }

  const clienteV = arred2(total * (perc / 100));
  const empresaV = arred2(total - clienteV);

  const diff = arred2(empresaV - pixV);
  let saidaTexto = "";
  if (diff > 0) saidaTexto = `💰 Valor em espécie a recolher: R$ ${diff.toFixed(2)}`;
  else if (diff < 0) saidaTexto = `💸 Repassar ao cliente: R$ ${Math.abs(diff).toFixed(2)}`;
  else saidaTexto = `✅ Nada a recolher/repassar`;

  // ✅ Validação: relógio tem que bater com pix+dinheiro (quando relógio preenchido)
  let aviso = "";
  if (temRelogio) {
    const ok = Math.abs(arred2(totalRelogio - totalValores)) <= 0.01; // tolerância 1 centavo
    if (!ok) {
      aviso = `
        <div style="margin-top:10px; padding:10px; border-radius:10px; background:#7f1d1d; color:#fff;">
          ❌ <b>Cálculo errado!</b><br>
          Relógio (R$ ${totalRelogio.toFixed(2)}) não bate com PIX+Dinheiro (R$ ${totalValores.toFixed(2)}).<br>
          Ajuste PIX/Dinheiro antes de salvar.
        </div>
      `;
    } else {
      aviso = `
        <div style="margin-top:10px; padding:10px; border-radius:10px; background:#14532d; color:#fff;">
          ✅ Valores conferem: Relógio = PIX + Dinheiro
        </div>
      `;
    }
  }

  resultado.innerHTML = `
    <strong>📊 Resultado do Acerto</strong><br><br>

    ${temRelogio
      ? `🕒 Total pelo relógio: R$ ${totalRelogio.toFixed(2)}<br>`
      : `🧮 Total pelos valores: R$ ${totalValores.toFixed(2)}<br>`}

    💳 PIX: R$ ${pixV.toFixed(2)} | 💵 Dinheiro: R$ ${dinV.toFixed(2)}<br><br>

    🏢 Valor da empresa: R$ ${empresaV.toFixed(2)}<br>
    👤 Comissão do cliente: R$ ${clienteV.toFixed(2)}<br><br>

    ${saidaTexto}<br>
    ✅ PIX já foi direto para a empresa

    ${aviso}
  `;
}

// ======================
// ACERTO: % do Cliente pega da base (porcBase) da máquina
// - Preenche automaticamente quando achar a máquina
// - Se o usuário mexer no campo, não sobrescreve mais
// ======================
let percAcertoTravadoPeloUser = false;
let ultimoNumeroAcertoAplicado = null;

function aplicarPorcBaseNoAcerto(maquina) {
  const percEl = document.getElementById("porcentagem");
  if (!percEl) return;

  const base = maquina?.porcBase;

  // se não tem base salva, não faz nada
  if (base == null || base === "") return;

  // só aplica se o usuário ainda não mexeu OU se mudou de máquina
  const mudouMaquina = String(maquina.numero || "") !== String(ultimoNumeroAcertoAplicado || "");

  if (!percAcertoTravadoPeloUser || mudouMaquina) {
    percEl.value = String(base);
    ultimoNumeroAcertoAplicado = String(maquina.numero || "");
    atualizarPreviewAcerto(); // recalcula na hora
  }
}

// se o usuário mexer na porcentagem, para de auto sobrescrever
document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "porcentagem") {
    percAcertoTravadoPeloUser = true;
  }
});

// helper para limpar % quando não achar máquina
function limparPorcentagemAcerto() {
  const p = document.getElementById("porcentagem");
  if (p) p.value = "";
  ultimoNumeroAcertoAplicado = null;
  percAcertoTravadoPeloUser = false;
  atualizarPreviewAcerto();
}


/* ===== SALVAR ACERTO ===== */
async function salvarAcerto() {
  const maquina = acharMaquinaPorCampos();

  if (!maquina) {
    alert("❌ Máquina não encontrada (confira número ou estabelecimento)");
    return;
  }

  const rAntEl = document.getElementById("relogioAnterior");
  const rAtuEl = document.getElementById("relogioAtual");

  if (!rAntEl || !rAtuEl) {
    alert("❌ Falta os campos de Relógio no HTML");
    return;
  }

  if (!isAdmin()) {
    rAntEl.value = maquina.ultimoRelogio != null ? String(maquina.ultimoRelogio) : "";
  }

  const rAnt = Number(rAntEl.value || 0);
  const rAtu = Number(rAtuEl.value || 0);

  if (!rAnt || !rAtu) {
    alert("❌ Preencha Relógio Anterior e Relógio Atual");
    return;
  }

  if (rAtu < rAnt) {
    alert("❌ Relógio Atual não pode ser menor que o Relógio Anterior");
    return;
  }

  // ✅ AQUI É O LOCAL CERTO (OBRIGAR PREENCHER PIX/DINHEIRO)
  const pixEl = document.getElementById("pix");
  const dinEl = document.getElementById("dinheiro");

  if (!pixEl || !dinEl) return alert("❌ Campos PIX/Dinheiro não encontrados.");

  if (pixEl.value.trim() === "" || dinEl.value.trim() === "") {
    alert("❌ Preencha PIX e Dinheiro (use 0 se não tiver).");
    return;
  }

  // ✅ agora pode ler valores
  const totalRelogio = arred2(rAtu - rAnt);

  const pixV = Number(pixEl.value || 0);
  const dinV = Number(dinEl.value || 0);
  const perc = Number(document.getElementById("porcentagem")?.value || 0);

  // ✅ TRAVA: relógio precisa bater com PIX + Dinheiro
  const somaValores = arred2(pixV + dinV);
  const bateu = Math.abs(arred2(totalRelogio - somaValores)) <= 0.01;

  if (!bateu) {
    alert(
      "❌ Cálculo errado!\n\n" +
      `Relógio (Atual - Anterior) = R$ ${totalRelogio.toFixed(2)}\n` +
      `PIX + Dinheiro = R$ ${somaValores.toFixed(2)}\n\n` +
      "Ajuste PIX/Dinheiro para bater com o relógio.\nNão foi salvo."
    );
    return;
  }

  const total = totalRelogio;
  const clienteV = total * (perc / 100);
  const empresaV = total - clienteV;

  const diff = empresaV - pixV;
  const especieRecolher = diff > 0 ? diff : 0;
  const repassarCliente = diff < 0 ? Math.abs(diff) : 0;

  acertos.push({
    numero: maquina.numero,
    estab: maquina.estab,
    relogioAnterior: rAnt,
    relogioAtual: rAtu,
    totalRelogio: totalRelogio,
    pix: pixV,
    dinheiro: dinV,
    porcentagem: perc,
    cliente: clienteV,
    empresa: empresaV,
    especieRecolher,
    repassarCliente,
    data: isoLocalAgora(),
  });

  maquina.ultimoRelogio = rAtu;

  salvarNoFirebase();

  alert("✅ Acerto salvo com sucesso");

  document.getElementById("numAcerto").value = "";
  document.getElementById("estabAcerto").value = "";
  document.getElementById("relogioAnterior").value = "";
  document.getElementById("relogioAtual").value = "";
  pixEl.value = "";
  dinEl.value = "";
  document.getElementById("porcentagem").value = "";
  const res = document.getElementById("resultado");
  if (res) res.innerHTML = "";

  voltar();
}


/* ======================
   LOCALIZAÇÃO
====================== */
function pegarLocalizacao() {
  const local = $("local");
  navigator.geolocation.getCurrentPosition((pos) => {
    if (local) {
      local.textContent = `Lat: ${pos.coords.latitude} | Long: ${pos.coords.longitude}`;
    }
  });
}




function voltarParaStatus() {
  // esconde telas internas
  document.querySelectorAll("#app .box").forEach((b) => {
    b.classList.add("escondido");
    b.style.display = "none";
  });

  // mostra a tela do status
  const tela = document.getElementById("status");
  if (tela) {
    tela.classList.remove("escondido");
    tela.style.display = "block";
  }

  window.scrollTo({ top: 0, behavior: "auto" });
}


function fcSetDiarioHoje() {
  const ini = document.getElementById("fcIni");
  const fim = document.getElementById("fcFim");
  if (!ini || !fim) return;

  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, "0");
  const d = String(hoje.getDate()).padStart(2, "0");
  const v = `${y}-${m}-${d}`;

  ini.value = v;
  fim.value = v;
}


function fcSetMensalAtual() {
  const ini = document.getElementById("fcIni");
  const fim = document.getElementById("fcFim");
  if (!ini || !fim) return;

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11

  const first = new Date(y, m, 1, 12, 0, 0);
  const last  = new Date(y, m + 1, 0, 12, 0, 0);

  const f = (d) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  ini.value = f(first);
  fim.value = f(last);
}



function abrirDetalhesCliente(estab) {
  // esconde só as telas internas do app (não mexe no login)
  document.querySelectorAll("#app .box").forEach((b) => {
    b.classList.add("escondido");
    b.style.display = "none";
  });

  // mostra a tela de detalhes
  const tela = document.getElementById("detalhesStatus");
  if (tela) {
    tela.classList.remove("escondido");
    tela.style.display = "block";
  } else {
    alert("❌ Não achei o elemento #detalhesStatus no HTML");
    return;
  }

  const titulo = document.getElementById("tituloDetalhes");
  const resumo = document.getElementById("resumoDetalhes");
  const lista  = document.getElementById("listaDetalhes");

  if (titulo) titulo.textContent = `📊 ${String(estab).toUpperCase()} — Acertos do Mês`;
  if (resumo) resumo.innerHTML = "";
  if (lista)  lista.innerHTML = "";

  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const acertosMes = (acertos || [])
    .filter((a) => {
      const d = new Date(a.data);
      return (
        String(a.estab || "").toUpperCase().trim() === String(estab).toUpperCase().trim() &&
        d.getMonth() === mesAtual &&
        d.getFullYear() === anoAtual
      );
    })
    .sort((a, b) => new Date(a.data) - new Date(b.data));

  if (!lista) return;

  if (acertosMes.length === 0) {
    lista.innerHTML = "<li>❌ Nenhum acerto neste mês</li>";
    return;
  }

  let somaPix = 0, somaDin = 0, somaEmpresa = 0, somaCliente = 0, somaRecolher = 0, somaRepassar = 0, somaTotalRelogio = 0;

  acertosMes.forEach((a) => {
    const d = new Date(a.data);

    somaPix += Number(a.pix || 0);
    somaDin += Number(a.dinheiro || 0);
    somaEmpresa += Number(a.empresa || 0);
    somaCliente += Number(a.cliente || 0);
    somaRecolher += Number(a.especieRecolher || 0);
    somaRepassar += Number(a.repassarCliente || 0);
    somaTotalRelogio += Number(a.totalRelogio || 0);

    const li = document.createElement("li");
    li.innerHTML = `
      📅 ${d.toLocaleDateString()} ${d.toLocaleTimeString()}<br>
      🕒 Relógio: ${a.relogioAnterior ?? "-"} → ${a.relogioAtual ?? "-"} (Total: ${Number(a.totalRelogio || 0).toFixed(2)})<br>
      💳 Pix: R$ ${Number(a.pix || 0).toFixed(2)} | 💵 Dinheiro: R$ ${Number(a.dinheiro || 0).toFixed(2)}<br>
      🏢 Empresa: R$ ${Number(a.empresa || 0).toFixed(2)} | 👤 Cliente: R$ ${Number(a.cliente || 0).toFixed(2)}<br>
      💰 Recolher: R$ ${Number(a.especieRecolher || 0).toFixed(2)} | 💸 Repassar: R$ ${Number(a.repassarCliente || 0).toFixed(2)}
    `;
    lista.appendChild(li);
  });

  if (resumo) {
    resumo.innerHTML = `
      <strong>Resumo do Mês</strong><br>
      🕒 Total pelo relógio: R$ ${somaTotalRelogio.toFixed(2)}<br>
      💳 Pix: R$ ${somaPix.toFixed(2)} | 💵 Dinheiro: R$ ${somaDin.toFixed(2)}<br>
      🏢 Empresa: R$ ${somaEmpresa.toFixed(2)} | 👤 Cliente: R$ ${somaCliente.toFixed(2)}<br>
      💰 A recolher: R$ ${somaRecolher.toFixed(2)} | 💸 A repassar: R$ ${somaRepassar.toFixed(2)}
    `;
  }

  window.scrollTo({ top: 0, behavior: "auto" });
}


function arred2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function corrigirStatusMaquinas() {
  if (!Array.isArray(maquinas)) return;
  maquinas.forEach(m => {
    m.status = normalizarStatus(m.status);
  });
}


// ====== LISTA DE MÁQUINAS ======
// ====== LISTA DE MÁQUINAS ======
function listarMaquinas() {
  const ul = document.getElementById("listaMaquinas");
  if (!ul) return;

  const listaBase = Array.isArray(maquinas) ? maquinas.slice() : [];

  // filtro: "DEPOSITO" ou "CADASTRADAS"
  const filtro = String(window.filtroMaquinas || "").toUpperCase().trim();

  // ✅ filtro robusto (depósito por status OU por estab)
  const lista = listaBase.filter((m) => {
    const depo = ehDeposito(m);

    // ✅ DEPÓSITO: só depósito
    if (filtro === "DEPOSITO") return depo;

    // ✅ CADASTRADAS: NÃO mostra depósito
    if (filtro === "CADASTRADAS") return !depo;

    // sem filtro: mostra tudo
    return true;
  });

  // ordena por número (com compare numérico)
  lista.sort((a, b) => {
    const na = String(a?.numero ?? "").trim();
    const nb = String(b?.numero ?? "").trim();
    return na.localeCompare(nb, "pt-BR", { numeric: true, sensitivity: "base" });
  });

  // ✅ Atualiza o título com quantidade
  const titulo = document.getElementById("tituloMaquinas");
  if (titulo) {
    const nomeTela =
      (filtro === "DEPOSITO") ? "Máquinas no Depósito" :
      (filtro === "CADASTRADAS") ? "Máquinas Cadastradas" :
      "Máquinas";

    titulo.textContent = `👥 ${nomeTela} (${lista.length})`;
  }

  ul.innerHTML = "";

  lista.forEach((m) => {
    const numero = String(m?.numero ?? "").trim();
    const estab  = String(m?.estab ?? m?.nomeEstab ?? "").trim();
    const status = String(m?.status ?? "").trim();
    const fotoSrc = String(m?.fotoUrl || m?.foto || "").trim();

    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.gap = "12px";
    li.style.cursor = "pointer";

    const thumb = document.createElement("div");
    thumb.style.width = "56px";
    thumb.style.height = "56px";
    thumb.style.borderRadius = "12px";
    thumb.style.background = "#0f172a";
    thumb.style.display = "flex";
    thumb.style.alignItems = "center";
    thumb.style.justifyContent = "center";
    thumb.style.flex = "0 0 56px";
    thumb.style.overflow = "hidden";

    if (fotoSrc) {
      const img = document.createElement("img");
      img.src = fotoSrc;
      img.alt = "foto";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      thumb.appendChild(img);
    } else {
      thumb.textContent = "📷";
      thumb.style.fontSize = "22px";
      thumb.style.opacity = "0.9";
    }

    // ✅ clique no quadrado abre foto cheia
    thumb.style.cursor = "pointer";
    thumb.onclick = (e) => {
      e.stopPropagation();
      try { abrirFotoMaquina(numero); } catch (err) { console.error(err); }
    };

    const info = document.createElement("div");
    info.style.flex = "1";
    info.style.textAlign = "left";

    const t1 = document.createElement("div");
    t1.style.fontWeight = "900";
    t1.style.letterSpacing = "0.4px";
    t1.textContent = (estab || "SEM ESTABELECIMENTO").toUpperCase();

    const t2 = document.createElement("div");
    t2.style.opacity = "0.9";
    t2.style.marginTop = "2px";

    // ✅ REGRA: em CADASTRADAS não mostra status (porque todas já estão alugadas)
    const filtroAtual = String(window.filtroMaquinas || "").toUpperCase().trim();
    const mostrarStatus = (filtroAtual !== "CADASTRADAS");

    // status normalizado só pra mostrar (evita "DEPÓSITO" vs "DEPOSITO" confuso)
    const statusShow = normalizarStatus(status);

    t2.textContent = `JB Nº ${numero || "?"}${(mostrarStatus && statusShow) ? " • " + statusShow : ""}`;

    info.appendChild(t1);
    info.appendChild(t2);

    li.appendChild(thumb);
    li.appendChild(info);

    li.onclick = () => {
      try {
        window.maquinaSelecionadaNumero = numero;
        if (typeof abrir === "function") abrir("detalheMaquina");

        const detNumero   = document.getElementById("detNumero");
        const detEstab    = document.getElementById("detEstab");
        const detCliente  = document.getElementById("detCliente");
        const detFone     = document.getElementById("detFone");
        const detEndereco = document.getElementById("detEndereco");
        const detStatus   = document.getElementById("detStatus");

        if (detNumero) detNumero.value = numero;
        if (detEstab) detEstab.value = estab;
        if (detCliente) detCliente.value = String(m?.cliente ?? m?.nomeCliente ?? "").trim();
        if (detFone) detFone.value = String(m?.tel ?? m?.fone ?? m?.foneCliente ?? "").trim();
        if (detEndereco) detEndereco.value = String(m?.endereco ?? "").trim();

        // ✅ status sempre normalizado para o select bater
        if (detStatus) detStatus.value = normalizarStatus(m?.status || "ALUGADA");

        if (typeof carregarMaquinaPorNumero === "function") carregarMaquinaPorNumero();
      } catch (e) {
        console.error(e);
      }
    };

    ul.appendChild(li);
  });
}


// ====== ABRIR DETALHE (CORRIGIDA) ======
function abrirDetalheMaquina(numero) {
  maquinaSelecionadaNumero = String(numero || "").trim().toUpperCase();

  abrir("detalheMaquina");

  const m = (maquinas || []).find(
    x => String(x.numero || "").trim().toUpperCase() === maquinaSelecionadaNumero
  );

  if (!m) {
    alert("Máquina não encontrada");
    voltar();
    return;
  }

  // elementos
  const tituloMaquina = document.getElementById("tituloMaquina");
  const detNumero   = document.getElementById("detNumero");
  const detEstab    = document.getElementById("detEstab");
  const detCliente  = document.getElementById("detCliente");
  const detEndereco = document.getElementById("detEndereco");
  const detStatus   = document.getElementById("detStatus");
  const detFone     = document.getElementById("detFone");

  // extras
  const detCpf      = document.getElementById("detCpf");
  const detRg       = document.getElementById("detRg");
  const detPorcBase = document.getElementById("detPorcBase");
  const erroCpfRg   = document.getElementById("erroCpfRgDetalhe");

  // ✅ comportamento automático DEPÓSITO (limpa tudo e trava)
  function aplicarUIStatusDeposito() {
    const st = detStatus?.value || "ALUGADA";

    const dep = (typeof isDepositoStatus === "function")
      ? isDepositoStatus(st)
      : (String(st || "").toUpperCase() === "DEPOSITO" || String(st || "").toUpperCase() === "DEPÓSITO");

    function lock(el, val, title) {
      if (!el) return;
      if (val !== undefined) el.value = val;
      el.disabled = true;
      el.readOnly = true;
      el.style.opacity = "0.7";
      el.style.cursor = "not-allowed";
      el.title = title || "";
    }

    function unlock(el) {
      if (!el) return;
      el.disabled = false;
      el.readOnly = false;
      el.style.opacity = "1";
      el.style.cursor = "text";
      el.title = "";
    }

    if (dep) {
      lock(detEstab, (typeof labelDeposito === "function") ? labelDeposito() : "DEPÓSITO", "DEPÓSITO preenche automático");
      lock(detCliente, "", "DEPÓSITO não usa cliente");
      lock(detCpf, "", "DEPÓSITO não usa CPF");
      lock(detRg, "", "DEPÓSITO não usa RG");
      lock(detPorcBase, "0", "DEPÓSITO não usa % base");
      lock(detFone, "", "DEPÓSITO não usa telefone");

      if (erroCpfRg) erroCpfRg.style.display = "none";
    } else {
      unlock(detEstab);
      unlock(detCliente);
      unlock(detCpf);
      unlock(detRg);
      unlock(detPorcBase);
      unlock(detFone);
    }
  }

  // ✅ 1) seta status PRIMEIRO (isso resolve seu bug)
  if (detStatus) detStatus.value = (m.status || "ALUGADA");

  // ✅ 2) preenche tudo
  if (tituloMaquina) tituloMaquina.textContent = `🔧 ${m.estab} (JB Nº ${m.numero})`;

  if (detNumero) {
    detNumero.value = String(m.numero || "");

    detNumero.readOnly = true;
    detNumero.disabled = true;
    detNumero.style.opacity = "0.7";
    detNumero.style.cursor = "not-allowed";
    detNumero.title = "Número não pode ser alterado";
  }

  if (detEstab) detEstab.value = String(m.estab || "").toUpperCase();
  if (detCliente) detCliente.value = String(m.cliente || "").toUpperCase();

  if (detEndereco) {
    if (m.lat != null && m.lng != null) {
      detEndereco.value = `LAT:${Number(m.lat).toFixed(6)} | LNG:${Number(m.lng).toFixed(6)}`;
    } else {
      detEndereco.value = String(m.endereco || "").toUpperCase();
    }
  }

  if (detFone) detFone.value = (typeof pegarTelefoneDaMaquina === "function") ? pegarTelefoneDaMaquina(m) : "";

  if (detCpf) detCpf.value = String(m.cpf || "");
  if (detRg) detRg.value = String(m.rg || "");
  if (detPorcBase) detPorcBase.value = (m.porcBase != null ? String(m.porcBase) : "");

  // ✅ 3) agora sim aplica DEPÓSITO no final e prende no onchange
  if (detStatus) {
    detStatus.onchange = aplicarUIStatusDeposito;
    aplicarUIStatusDeposito();
  }

  // maiúsculas ao digitar (quando estiver liberado)
  if (detEstab) detEstab.oninput = () => detEstab.value = detEstab.value.toUpperCase();
  if (detCliente) detCliente.oninput = () => detCliente.value = detCliente.value.toUpperCase();
  if (detEndereco) detEndereco.oninput = () => detEndereco.value = detEndereco.value.toUpperCase();
}

function carregarMaquinaPorNumero() {
  const detNumero = document.getElementById("detNumero");
  const detEstab = document.getElementById("detEstab");
  const detCliente = document.getElementById("detCliente");
  const detEndereco = document.getElementById("detEndereco");
  const detStatus = document.getElementById("detStatus");
  const detFone = document.getElementById("detFone");
  const tituloMaquina = document.getElementById("tituloMaquina");

  // ✅ NOVOS CAMPOS NO DETALHE
  const detCpf = document.getElementById("detCpf");
  const detRg = document.getElementById("detRg");
  const detPorcBase = document.getElementById("detPorcBase");
  const erroCpfRg = document.getElementById("erroCpfRgDetalhe");

  if (!detNumero) return;

  const numeroInput = detNumero.value.trim().toUpperCase();
  detNumero.value = numeroInput;

  // se apagou o número, limpa tudo
  if (!numeroInput) {
    maquinaSelecionadaNumero = null;
    if (detEstab) detEstab.value = "";
    if (detCliente) detCliente.value = "";
    if (detEndereco) detEndereco.value = "";
    if (detStatus) detStatus.value = "ALUGADA";
    if (detFone) detFone.value = "";
    if (tituloMaquina) tituloMaquina.textContent = `🔧 Máquina`;

    // ✅ limpa novos campos
    if (detCpf) detCpf.value = "";
    if (detRg) detRg.value = "";
    if (detPorcBase) detPorcBase.value = "";
    if (erroCpfRg) erroCpfRg.style.display = "none";
    return;
  }

  // procura a máquina
  const m = (maquinas || []).find(x => String(x.numero).toUpperCase() === numeroInput);

  // não achou
  if (!m) {
    maquinaSelecionadaNumero = null;
    if (detEstab) detEstab.value = "";
    if (detCliente) detCliente.value = "";
    if (detEndereco) detEndereco.value = "";
    if (detStatus) detStatus.value = "ALUGADA";
    if (detFone) detFone.value = "";
    if (tituloMaquina) tituloMaquina.textContent = `🔧 Máquina não encontrada`;

    // ✅ limpa novos campos
    if (detCpf) detCpf.value = "";
    if (detRg) detRg.value = "";
    if (detPorcBase) detPorcBase.value = "";
    if (erroCpfRg) erroCpfRg.style.display = "none";
    return;
  }

  // achou -> preenche tudo
  maquinaSelecionadaNumero = m.numero;

  if (detEstab) detEstab.value = (m.estab || "").toUpperCase();
  if (detCliente) detCliente.value = (m.cliente || "").toUpperCase();

  if (detEndereco) {
    if (m.lat != null && m.lng != null) {
      detEndereco.value = `LAT:${Number(m.lat).toFixed(6)} | LNG:${Number(m.lng).toFixed(6)}`;
    } else {
      detEndereco.value = (m.endereco || "").toUpperCase();
    }
  }

  if (detStatus) detStatus.value = (m.status || "ALUGADA");
  if (detFone) detFone.value = pegarTelefoneDaMaquina(m);

  if (tituloMaquina) tituloMaquina.textContent = `🔧 ${m.estab} (JB Nº ${m.numero})`;

  // ✅ preenche CPF/RG
  if (detCpf) detCpf.value = String(m.cpf || "");
  if (detRg) detRg.value = String(m.rg || "");

  // ✅ preenche % base
  if (detPorcBase) detPorcBase.value = (m.porcBase != null ? String(m.porcBase) : "");

  // ✅ aviso: precisa ter CPF ou RG (pelo menos um)
  if (erroCpfRg) {
    const cpf = String(m.cpf || "").trim();
    const rg = String(m.rg || "").trim();
    erroCpfRg.style.display = (!cpf && !rg) ? "block" : "none";
  }
}


let maquinaSelecionadaNumero = null;
 

// ======================
// UTIL: data/hora local em ISO (SEM mudar o dia por fuso)
// ======================
function isoLocalAgora(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${m}-${day}T${h}:${min}:${s}`;
}


function arAutoPorNumero() {
  const numEl = document.getElementById("arNum");
  const estabEl = document.getElementById("arEstab");
  const cliEl = document.getElementById("arCliente");

  if (!numEl || !estabEl || !cliEl) return;

  const num = (numEl.value || "").trim().toUpperCase();
  numEl.value = num;

  estabEl.value = "";
  cliEl.value = "";

  if (!num) return;

  const m = (maquinas || []).find(x => String(x.numero || "").toUpperCase() === num);
  if (!m) {
    estabEl.value = "❌ MÁQUINA NÃO ENCONTRADA";
    cliEl.value = "";
    return;
  }

  estabEl.value = String(m.estab || "").toUpperCase();
  cliEl.value = String(m.cliente || "").toUpperCase();
}
async function salvarRelogioAtualAdmin() {
  if (!exigirAdmin()) return; // ✅ só ADMIN/MASTER

  const num = (document.getElementById("arNum")?.value || "").trim().toUpperCase();

  // ✅ inteiro (sem .00)
  const rel = parseInt(document.getElementById("arRelogioAtual")?.value || "0", 10);

  if (!num) return alert("❌ Digite o número da maquina.");
  if (!Number.isFinite(rel) || rel <= 0) return alert("❌ Digite um relógio válido (maior que 0).");

  const m = (maquinas || []).find(x => String(x.numero || "").toUpperCase() === num);
  if (!m) return alert("❌ Máquina não encontrada.");

  // anterior também como inteiro
  const antes = m.ultimoRelogio != null ? parseInt(m.ultimoRelogio, 10) : 0;

  // ✅ ADMIN pode diminuir ou aumentar (sem trava)

  // ✅ salva como inteiro
  m.ultimoRelogio = rel;

  // ✅ IMPORTANTE: persistir e atualizar telas/contadores
  if (typeof salvarNoFirebase === "function") salvarNoFirebase();

  // ✅ se existir alguma função que atualiza a home/menu, chama
  if (typeof atualizarMenu === "function") atualizarMenu();
  if (typeof atualizarBotoesMenu === "function") atualizarBotoesMenu();
  if (typeof renderAcertos === "function") renderAcertos();
  if (typeof listarAcertos === "function") listarAcertos();
  if (typeof atualizarAcerto === "function") atualizarAcerto();
  if (typeof atualizarStatus === "function") atualizarStatus();

  alert(`✅ Relógio atualizado.\nAnterior: ${antes}\nAtual: ${rel}`);
}


function exigirLogado() {
  if (!isLogado()) {
    alert("❌ Faça login primeiro.");
    mostrarTelaLogin();
    limparCamposLogin();
    return false;
  }
  return true;
}



async function salvarAlteracoesMaquina() {
  try {
    const detNumero  = document.getElementById("detNumero");
    const detEstab   = document.getElementById("detEstab");
    const detCliente = document.getElementById("detCliente");
    const detEndereco= document.getElementById("detEndereco");
    const detStatus  = document.getElementById("detStatus");
    const detFone    = document.getElementById("detFone");

    // ✅ novos campos do detalhe
    const detCpf = document.getElementById("detCpf");
    const detRg  = document.getElementById("detRg");
    const detPorcBase = document.getElementById("detPorcBase");
    const erroCpfRg = document.getElementById("erroCpfRgDetalhe");

    const numero = (detNumero?.value || "").trim().toUpperCase();
    if (!numero) {
      alert("❌ Informe o número da jukebox.");
      detNumero?.focus();
      return;
    }

    // acha a máquina
    const m = (maquinas || []).find(x => String(x.numero || "").toUpperCase() === numero);
    if (!m) {
      alert("❌ Máquina não encontrada.");
      return;
    }

    // lê campos
    const estab = (detEstab?.value || "").trim().toUpperCase();
    const cliente = (detCliente?.value || "").trim().toUpperCase();
    const enderecoTxt = (detEndereco?.value || "").trim().toUpperCase();
    const status = (detStatus?.value || "ALUGADA");
    const foneTxt = (detFone?.value || "").trim();

    const cpf = (detCpf?.value || "").trim();
    const rg  = (detRg?.value  || "").trim();

    // ✅ só exige CPF/RG se NÃO for DEPÓSITO
    const ehDeposito = (typeof isDepositoStatus === "function")
      ? isDepositoStatus(status)
      : (String(status || "").toUpperCase() === "DEPOSITO" || String(status || "").toUpperCase() === "DEPÓSITO");

    if (!ehDeposito) {
      // ALUGADA (ou qualquer status que use cliente)
      if (!cpf && !rg) {
        if (erroCpfRg) erroCpfRg.style.display = "block";
        alert("❌ Preencha CPF ou RG (pelo menos um).");
        detCpf?.focus();
        return;
      } else {
        if (erroCpfRg) erroCpfRg.style.display = "none";
      }
    } else {
      // DEPÓSITO: não valida documento
      if (erroCpfRg) erroCpfRg.style.display = "none";
    }

    // ✅ % base do cliente (0 a 100)
    let porcBase = Number(detPorcBase?.value || 0);
    if (!Number.isFinite(porcBase)) porcBase = 0;
    if (porcBase < 0) porcBase = 0;
    if (porcBase > 100) porcBase = 100;

    // telefone -> ddd/tel (igual seu padrão)
    const nums = foneTxt.replace(/\D/g, "").slice(0, 11);
    const ddd = nums.slice(0, 2);
    const tel = nums.slice(2);

    // aplica alterações no objeto
    m.status = normalizarStatus ? normalizarStatus(status) : String(status || "ALUGADA").trim().toUpperCase();

    if (ehDeposito) {
      // ✅ DEPÓSITO: sem cliente, sem docs, sem telefone
      m.estab = (typeof labelDeposito === "function") ? labelDeposito() : "DEPÓSITO";
      m.cliente = "";
      m.cpf = "";
      m.rg = "";
      m.porcBase = 0;

      // ✅ limpa telefone também (pra não aparecer mais)
      m.ddd = "";
      m.tel = "";
      m.foneFormatado = "";
    } else {
      // ✅ ALUGADA: normal
      m.estab = estab;
      m.cliente = cliente;
      m.cpf = cpf;
      m.rg = rg;
      m.porcBase = porcBase;

      // telefone normal
      m.ddd = ddd;
      m.tel = tel;
      m.foneFormatado = (typeof formatarTelefoneBR === "function")
        ? formatarTelefoneBR(foneTxt)
        : String(foneTxt || "");
    }

    // endereço: não sobrescreve se estiver mostrando GPS "LAT: | LNG:"
    if (!/^LAT:\-?\d+(\.\d+)?\s*\|\s*LNG:\-?\d+(\.\d+)?$/i.test(enderecoTxt)) {
      m.endereco = enderecoTxt;
    }

    // ✅ IMPORTANTE:
    // Removido o bloco que sobrescrevia DEPÓSITO:
    // m.cpf = cpf; m.rg = rg; m.porcBase = porcBase;

    // persistir
    const ok = (typeof salvarNoFirebase === "function") ? await salvarNoFirebase(true) : true;
    if (!ok) return;

    alert("✅ Alterações salvas com sucesso!");
  } catch (e) {
    console.error("❌ Erro em salvarAlteracoesMaquina:", e);
    alert("❌ Não consegui salvar. Veja o Console (F12).");
  }
}

function pedirSenhaAdmin() {
  return new Promise((resolve) => {
    // fundo escuro
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,.65)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    // caixinha
    const box = document.createElement("div");
    box.style.width = "320px";
    box.style.maxWidth = "90%";
    box.style.background = "#1f2a3a";
    box.style.borderRadius = "12px";
    box.style.padding = "16px";
    box.style.color = "#fff";
    box.style.boxShadow = "0 10px 25px rgba(0,0,0,.35)";

    box.innerHTML = `
      <h3 style="margin:0 0 10px 0;">🔐 Senha do Administrador</h3>
      <p style="margin:0 0 10px 0; opacity:.9;">Digite a senha para continuar:</p>
      <input id="adminSenhaInput" type="password" placeholder="••••••••"
        style="width:100%; padding:10px; border-radius:10px; border:none; outline:none; margin-bottom:12px;">

      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button id="adminCancelar"
          style="padding:10px 12px; border-radius:10px; border:none; cursor:pointer;">
          Cancelar
        </button>
        <button id="adminConfirmar"
          style="padding:10px 12px; border-radius:10px; border:none; cursor:pointer; background:#2ec55e; color:#0b1a12;">
          Confirmar
        </button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const input = box.querySelector("#adminSenhaInput");
    const btnOk = box.querySelector("#adminConfirmar");
    const btnCancel = box.querySelector("#adminCancelar");

    const fechar = (valor) => {
      document.body.removeChild(overlay);
      resolve(valor);
    };

    btnCancel.onclick = () => fechar(null);

    btnOk.onclick = () => fechar(input.value || "");

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnOk.click();
      if (e.key === "Escape") btnCancel.click();
    });

    // foco automático
    input.focus();
  });
}
// =====================
// LOCALIZAÇÃO (GPS) - salvar por máquina
// =====================

// guarda o GPS que foi pego no cadastro (até apertar "Salvar Máquina")
let cadastroGeoTemp = null;

// formata endereço com coords (pra aparecer no campo)
function textoGeo(lat, lng) {
  return `LAT:${lat.toFixed(6)} | LNG:${lng.toFixed(6)}`;
}

function abrirNoMaps(lat, lng) {
  const la = toNumberCoord(lat);
  const ln = toNumberCoord(lng);

  if (la === null || ln === null) {
    alert("❌ GPS inválido/ausente nessa máquina.");
    return;
  }

  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  // ✅ CELULAR: abre só o APP do Google Maps
  if (isAndroid) {
    // Android: abre direto no app (se tiver instalado)
    window.location.href = `geo:${la},${ln}?q=${la},${ln}`;
    return;
  }

  if (isIOS) {
    // iPhone: abre no Google Maps app (se tiver instalado)
    window.location.href = `comgooglemaps://?q=${la},${ln}&center=${la},${ln}&zoom=16`;
    return;
  }

  // ✅ PC: abre normal no navegador
  window.open(`https://www.google.com/maps?q=${la},${ln}`, "_blank", "noopener,noreferrer");
}



function debugFirebase() {
  console.log("firebasePronto:", firebasePronto);
  console.log("maquinas.length:", (maquinas || []).length);
  console.log("usuarios.length:", (usuarios || []).length);
  console.log("acertos.length:", (acertos || []).length);
  console.log("ocorrencias.length:", (ocorrencias || []).length);
  alert(`FirebasePronto: ${firebasePronto}\nMáquinas: ${(maquinas||[]).length}\nUsuários: ${(usuarios||[]).length}`);
}
window.debugFirebase = debugFirebase;

function pegarGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Sem suporte GPS"));

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function fmtBRL(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function toDateLocal(dateInputValue, endOfDay=false){
  // dateInputValue = "2026-01-14"
  if (!dateInputValue) return null;
  const [y,m,d] = dateInputValue.split("-").map(Number);
  const dt = new Date(y, m-1, d, 0,0,0,0);
  if (endOfDay) dt.setHours(23,59,59,999);
  return dt;
}



// ✅ modo do fechamento (padrão DIARIO)
let __fcModo = "DIARIO";

// ✅ pega uma data-base (usa fcIni se tiver, senão hoje)
function _fcDataBase() {
  const iniEl = document.getElementById("fcIni");
  if (iniEl && iniEl.value) return toDateLocal(iniEl.value, false);
  return new Date();
}

// ✅ seta datas do dia (ini=fim no mesmo dia)
function _fcSetDia(dt) {
  const iniEl = document.getElementById("fcIni");
  const fimEl = document.getElementById("fcFim");
  if (!iniEl || !fimEl) return;

  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const v = `${yyyy}-${mm}-${dd}`;

  iniEl.value = v;
  fimEl.value = v;
}

// ✅ seta datas do mês inteiro (01 até último dia)
function _fcSetMes(dt) {
  const iniEl = document.getElementById("fcIni");
  const fimEl = document.getElementById("fcFim");
  if (!iniEl || !fimEl) return;

  const y = dt.getFullYear();
  const m = dt.getMonth(); // 0-11

  const first = new Date(y, m, 1);
  const last  = new Date(y, m + 1, 0);

  const f1 = `${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,"0")}-${String(first.getDate()).padStart(2,"0")}`;
  const f2 = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`;

  iniEl.value = f1;
  fimEl.value = f2;
}

function fcSetModo(modo) {
  _fcModo = (String(modo || "DIARIO").toUpperCase() === "MENSAL") ? "MENSAL" : "DIARIO";

  if (_fcModo === "MENSAL") fcSetMensalAtual();
  else fcSetDiarioHoje();

  renderFechamentoCaixa();
}


function ligarEventosFechamentoCaixa() {
  const tela = document.getElementById("fechamentoCaixa");
  if (!tela) return;

  const botoes = [...tela.querySelectorAll("button")];

  const btnDiario = botoes.find(b => /di[aá]rio/i.test(b.textContent));
  const btnMensal = botoes.find(b => /mensal/i.test(b.textContent));
  const btnGerar  = botoes.find(b => /gerar/i.test(b.textContent));

  if (btnDiario) btnDiario.onclick = () => { console.log("CLICK DIARIO"); fcSetModo("DIARIO"); };
  if (btnMensal) btnMensal.onclick = () => { console.log("CLICK MENSAL"); fcSetModo("MENSAL"); };
  if (btnGerar)  btnGerar.onclick  = () => { console.log("CLICK GERAR");  renderFechamentoCaixa(); };
}



function setPeriodoHojeFechamento() {
  const ini = document.getElementById("fcIni");
  const fim = document.getElementById("fcFim");
  if (!ini || !fim) return;

  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth()+1).padStart(2,"0");
  const d = String(hoje.getDate()).padStart(2,"0");
  const s = `${y}-${m}-${d}`;

  if (!ini.value) ini.value = s;
  if (!fim.value) fim.value = s;
}


function keyDiaSP(dt) {
  const d = new Date(dt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const da = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${da}`; // yyyy-mm-dd
}


// ===============================
// FECHAMENTO: EDITAR % DO CLIENTE
// ===============================

// admin check (você já usa body.is-admin / body.is-master)
function fcIsAdmin() {
  return document.body.classList.contains("is-admin") ||
         document.body.classList.contains("is-master");
}

function fcMoney(v){
  return Number(v||0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

// chave do período (para não misturar um dia com outro)
function fcPeriodoKey() {
  const ini = document.getElementById("fcIni")?.value || "";
  const fim = document.getElementById("fcFim")?.value || "";
  const modo = String(window.__fcModo || window._fcModo || "DIARIO").toUpperCase();
  return `${modo}|${ini}|${fim}`;
}

// storage de overrides: { "DIARIO|2026-02-12|2026-02-12": { "RECANTO DAS GOIANAS": 30 } }
const FC_PCT_KEY = "fcPctOverride";

function fcGetPctOverrides() {
  try { return JSON.parse(localStorage.getItem(FC_PCT_KEY) || "{}"); }
  catch { return {}; }
}
function fcSetPctOverrides(obj) {
  localStorage.setItem(FC_PCT_KEY, JSON.stringify(obj || {}));
}

// estado do modal
let __pctCtx = null; // { estab, total }


function fcEnsureModalPct() {
  if (document.getElementById("modalEditarPctFC")) return;

  const wrap = document.createElement("div");
  wrap.id = "modalEditarPctFC";
  wrap.style.cssText = `
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,.6); z-index:99999;
  `;

  wrap.innerHTML = `
    <div style="width:min(520px,92vw); background:#0b1220; color:#fff; border-radius:16px; padding:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <b>Editar % do cliente</b>
        <button id="btnFecharModalPctFC">✖</button>
      </div>

      <div style="margin-top:10px;">
        <div id="pctFcEstab"></div>
        <div id="pctFcPeriodo"></div>
        <div>Total empresa: <b id="pctFcTotal"></b></div>
      </div>

      <div style="margin-top:12px;">
        <input id="pctFcNovo" type="number" min="0" max="100" step="0.01"
               style="width:100%; padding:10px; border-radius:10px;" />
      </div>

      <div style="margin-top:16px; display:flex; gap:10px; justify-content:flex-end;">
        <button id="btnCancelarModalPctFC">Cancelar</button>
        <button id="btnSalvarModalPctFC">Salvar</button>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  document.getElementById("btnFecharModalPctFC")?.addEventListener("click", fcFecharModalPct);
  document.getElementById("btnCancelarModalPctFC")?.addEventListener("click", fcFecharModalPct);
  document.getElementById("btnSalvarModalPctFC")?.addEventListener("click", fcSalvarPctModal);
  document.getElementById("pctFcNovo")?.addEventListener("input", fcAtualizarPreviewPct);
}



function fcAbrirModalPct(estab, total){
  fcEnsureModalPct();
  console.log("fcAbrirModalPct()", { estab, total, isAdmin: fcIsAdmin() });

  const m = document.getElementById("modalEditarPctFC");
  console.log("modalEditarPctFC existe?", !!m, m);

  console.log("ids:", {
    pctFcEstab: !!document.getElementById("pctFcEstab"),
    pctFcPeriodo: !!document.getElementById("pctFcPeriodo"),
    pctFcTotal: !!document.getElementById("pctFcTotal"),
    pctFcNovo: !!document.getElementById("pctFcNovo"),
    btnSalvar: !!document.getElementById("btnSalvarModalPctFC"),
    btnCancelar: !!document.getElementById("btnCancelarModalPctFC"),
    btnFechar: !!document.getElementById("btnFecharModalPctFC"),
  });

  if (!fcIsAdmin()) return alert("Somente ADMIN pode editar.");

  
}

function fcFecharModalPct(){
  const m = document.getElementById("modalEditarPctFC");
  if (m) m.style.display = "none";
  __pctCtx = null;
}

function fcAtualizarPreviewPct(){
  if (!__pctCtx) return;

  const pct = Number(document.getElementById("pctFcNovo")?.value || 0);
  const total = __pctCtx.total;

  const repassar = Math.max(0, total * (pct/100));
  const empresa = Math.max(0, total - repassar);
  const recolher = empresa; // preview (no seu fechamento, recolher final é calculado no render)

  document.getElementById("pctFcEmpresa").textContent = fcMoney(empresa);
  document.getElementById("pctFcRepassar").textContent = fcMoney(repassar);
  document.getElementById("pctFcRecolher").textContent = fcMoney(recolher);
}

function fcSalvarPctModal(){
  if (!__pctCtx) return;

  const pct = Number(document.getElementById("pctFcNovo")?.value || 0);
  if (pct < 0 || pct > 100) {
    alert("Percentual inválido (0 a 100).");
    return;
  }

  const all = fcGetPctOverrides();
  const key = fcPeriodoKey();
  all[key] = all[key] || {};
  all[key][__pctCtx.estab] = pct;

  fcSetPctOverrides(all);

  fcFecharModalPct();
  renderFechamentoCaixa();
  alert("✅ % do cliente atualizado nesse fechamento!");
}

// listeners (1 vez só)
if (!window.__fcPctModalBind) {
  window.__fcPctModalBind = true;

  document.getElementById("btnFecharModalPctFC")?.addEventListener("click", fcFecharModalPct);
  document.getElementById("btnCancelarModalPctFC")?.addEventListener("click", fcFecharModalPct);
  document.getElementById("btnSalvarModalPctFC")?.addEventListener("click", fcSalvarPctModal);
  document.getElementById("pctFcNovo")?.addEventListener("input", fcAtualizarPreviewPct);
}

// clique no botão ✏️ dentro de fcLista (delegação)
// clique no botão ✏️ dentro de fcLista (delegação)
function fcBindClickEditarPct() {
  if (window.__fcEditPctBind) return;
  window.__fcEditPctBind = true;

  // CAPTURE = pega o click antes de qualquer stopPropagation()
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-editarpct]");
    if (!btn) return;

    // trava o click aqui
    e.preventDefault();
    e.stopPropagation();

    const estab = btn.getAttribute("data-editarpct");
    console.log("✅ CLICK Editar % capturado", estab);

    if (!fcIsAdmin()) return alert("Somente ADMIN.");

    const ini = document.getElementById("fcIni")?.value;
    const fim = document.getElementById("fcFim")?.value;
    const dtIni = toDateLocal(ini, false);
    const dtFim = toDateLocal(fim, true);

    let totalEstab = 0;

    (acertos || []).forEach(a => {
      const d = parseDataLocalSemTZ(a.data);
      if (!d || d < dtIni || d > dtFim) return;

      const nome =
        a.estab || a.estabelecimento || a.nomeEstabelecimento || "Estabelecimento não informado";

      if (nome !== estab) return;

      // ✅ SOMA O TOTAL (RELÓGIO) — não usa a.empresa (porque muda com comissão)
      const totalRel = Number(
        a.totalRelogio ??
        a.total ??
        a.valorTotal ??
        (Number(a.pix || 0) + Number(a.dinheiro || 0)) ??
        a.empresa
      ) || 0;

      totalEstab += totalRel;
    });

    // abre modal com total correto
    fcAbrirModalPct(estab, totalEstab);
  }, true);
}

// ===============================
// ✅ REGRA: SEM CENTAVOS (CLIENTE x EMPRESA)
// - 0,00..0,49 -> "o real" fica pro CLIENTE  => comissão SOBE
// - 0,50..0,99 -> "o real" fica pra EMPRESA => comissão DESCE
// ===============================
function arredondarComissaoClienteSemCentavos(valor) {
  valor = Number(valor || 0);

  const base = Math.floor(valor);
  const cent = Math.round((valor - base) * 100); // 0..99 (blindado)

  if (cent === 0) return base;
  if (cent <= 49) return base + 1; // cliente ganha o real
  return base;                     // empresa ganha o real
}

function splitSemCentavos(totalRel, comissaoRaw) {
  const totalInt = Math.round(Number(totalRel || 0)); // total é inteiro
  const comissaoInt = arredondarComissaoClienteSemCentavos(comissaoRaw);
  const empresaInt = totalInt - comissaoInt;
  return { totalInt, comissaoInt, empresaInt };
}

function fmtBRLInt(v) {
  return "R$ " + Number(v || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}



function renderFechamentoCaixa() {
  const tela = document.getElementById("fechamentoCaixa") || document;

  let iniEl = document.getElementById("fcIni");
  let fimEl = document.getElementById("fcFim");
  let outResumo = document.getElementById("fcResumo");
  let outLista  = document.getElementById("fcLista");

  if (!iniEl || !fimEl) {
    const dates = tela.querySelectorAll?.("input[type='date']") || [];
    iniEl = iniEl || dates[0];
    fimEl = fimEl || dates[1];
  }

  if (!outResumo) {
    outResumo = document.createElement("div");
    outResumo.id = "fcResumo";
    tela.appendChild(outResumo);
  }
  if (!outLista) {
    outLista = document.createElement("div");
    outLista.id = "fcLista";
    tela.appendChild(outLista);
  }

  if (!iniEl?.value || !fimEl?.value) {
    outResumo.innerHTML = "❌ Selecione o período.";
    outLista.innerHTML = "";
    return;
  }

  try { fcBindClickEditarPct(); } catch {}

  const dtIni = toDateLocal(iniEl.value, false);
  const dtFim = toDateLocal(fimEl.value, true);

  const lista = (acertos || []).filter(a => {
    const d = parseDataLocalSemTZ(a.data);
    return d && d >= dtIni && d <= dtFim;
  });

  if (!lista.length) {
    outResumo.innerHTML = "✅ Nenhum acerto no período.";
    outLista.innerHTML = "";
    return;
  }

  const all = typeof fcGetPctOverrides === "function" ? fcGetPctOverrides() : {};
  const pKey = typeof fcPeriodoKey === "function" ? fcPeriodoKey() : "";
  const ovr = (all && pKey && all[pKey]) ? all[pKey] : {};

  const grupo = new Map();

  lista.forEach(a => {
    const estab =
      a.estab ||
      a.estabelecimento ||
      a.nomeEstabelecimento ||
      "Estabelecimento não informado";

    const totalRel = Number(
      a.totalRelogio ??
      a.total ??
      (Number(a.pix || 0) + Number(a.dinheiro || 0))
    ) || 0;

    const pix = Number(a.pix || 0);
    const especie = (a.dinheiro != null)
      ? Number(a.dinheiro || 0)
      : Math.max(0, totalRel - pix);

    const clienteBase = Number(a.cliente || 0);

    if (!grupo.has(estab)) {
      grupo.set(estab, {
        nome: estab,
        qt: 0,
        totalRel: 0,
        pix: 0,
        especie: 0,
        clienteBase: 0
      });
    }

    const g = grupo.get(estab);
    g.qt++;
    g.totalRel += totalRel;
    g.pix += pix;
    g.especie += especie;
    g.clienteBase += clienteBase;
  });

  function fmtPct(v){
    return Number(v||0).toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  let T_totalRel = 0;
  let T_pix = 0;
  let T_especie = 0;
  let T_cliente = 0;
  let T_empresa = 0;

  const modoMostrar = String(window.__fcModo || window._fcModo || "DIARIO").toUpperCase();
  let html = `<h3 style="margin:10px 0 8px;">📍 Estabelecimentos</h3>`;

  grupo.forEach(g => {

    const totalRel = g.totalRel;
    const pix = g.pix;
    const especie = g.especie;

    const pctBase = totalRel > 0 ? (g.clienteBase / totalRel) * 100 : 0;
    const pctOverride = ovr[g.nome];
    const temPctEditado = pctOverride != null && !isNaN(Number(pctOverride));
    const pctUsado = temPctEditado ? Number(pctOverride) : pctBase;

    const comissaoRaw = totalRel * (pctUsado / 100);
const { totalInt, comissaoInt, empresaInt } = splitSemCentavos(totalRel, comissaoRaw);

const pixInt = Math.round(pix);
const especieInt = Math.round(especie);

const saldoLiquido = empresaInt - pixInt;

T_totalRel += totalInt;
T_pix += pixInt;
T_especie += especieInt;
T_cliente += comissaoInt;
T_empresa += empresaInt;


    const btnEditar = (typeof fcIsAdmin === "function" && fcIsAdmin())
      ? `<button type="button" data-editarpct="${g.nome}"
          style="padding:10px 14px;border:none;border-radius:12px;background:#38bdf8;color:#0b1220;font-weight:900;cursor:pointer;">
          ✏️ Editar %
        </button>`
      : "";

    let saldoTexto = "";
    if (saldoLiquido > 0) {
      saldoTexto = `🪙 <b>A recolher (líquido):</b> ${fmtBRL(saldoLiquido)}`;
    } else if (saldoLiquido < 0) {
      saldoTexto = `🔁 <b>A repassar (líquido):</b> ${fmtBRL(Math.abs(saldoLiquido))}`;
    } else {
      saldoTexto = `✅ <b>Fechado (zerado)</b>`;
    }

    html += `
      <div style="background:#111827;padding:12px;border-radius:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <b>${g.nome.toUpperCase()}</b>
          ${btnEditar}
        </div>

        <div style="margin-top:6px;">✅ ${g.qt} acerto(s)</div>

        <div style="margin-top:10px;line-height:1.6;">
         ⏱️ <b>Total (Relógio):</b> ${fmtBRLInt(totalInt)}<br>
💳 <b>PIX:</b> ${fmtBRLInt(pixInt)}<br>
💵 <b>Espécie:</b> ${fmtBRLInt(especieInt)}<br><br>

👤 <b>Cliente (Comissão):</b> ${fmtBRLInt(comissaoInt)}
<small style="opacity:.8;">(${fmtPct(pctUsado)}%)</small><br>

🏢 <b>Empresa (Direito após comissão):</b> ${fmtBRLInt(empresaInt)}<br><br>

          <div style="padding:10px;border-radius:12px;background:#0f172a;">
            ${saldoTexto}
          </div>

          ${temPctEditado ? `<div style="margin-top:6px;font-size:12px;opacity:.7;">% editado no fechamento: <b>${fmtPct(pctOverride)}%</b></div>` : ""}
        </div>
      </div>
    `;
  });

  const saldoLiquidoGeral = T_empresa - T_pix;

  let saldoTopo = "";
  if (saldoLiquidoGeral > 0) {
    saldoTopo = `🪙 <b>A recolher (líquido):</b> ${fmtBRL(saldoLiquidoGeral)}`;
  } else if (saldoLiquidoGeral < 0) {
    saldoTopo = `🔁 <b>A repassar (líquido):</b> ${fmtBRL(Math.abs(saldoLiquidoGeral))}`;
  } else {
    saldoTopo = `✅ <b>Fechado (zerado)</b>`;
  }

  outResumo.innerHTML = `
    <div style="background:#0f172a;padding:12px;border-radius:12px;line-height:1.6;">
      <div style="text-align:center;font-weight:900;">Modo: ${modoMostrar}</div>
      <div style="text-align:center;">Período: ${iniEl.value.split("-").reverse().join("/")} até ${fimEl.value.split("-").reverse().join("/")}</div>

      <hr style="opacity:.2;margin:10px 0;">

      ⏱️ <b>Total (Relógio):</b> ${fmtBRL(T_totalRel)}<br>
      💳 <b>Total PIX:</b> ${fmtBRL(T_pix)}<br>
      💵 <b>Total Espécie:</b> ${fmtBRL(T_especie)}<br><br>

      👤 <b>Total Comissão (Clientes):</b> ${fmtBRL(T_cliente)}<br>
      🏢 <b>Total Empresa (Direito após comissão):</b> ${fmtBRL(T_empresa)}<br><br>

      <div style="padding:10px;border-radius:12px;background:#111827;">
        ${saldoTopo}
      </div>

      <div style="margin-top:10px;">✅ <b>Qtd acertos:</b> ${lista.length}</div>
    </div>
  `;

  outLista.innerHTML = html;
}


// ===============================
// REGRA DE ARREDONDAMENTO EMPRESA
// ===============================
function arredondarEmpresa(valor) {
  const inteiro = Math.floor(valor);
  const decimal = Math.round((valor - inteiro) * 100);

  if (decimal <= 49) {
    return inteiro;
  } else {
    return inteiro + 1;
  }
}



function toNumberCoord(v) {
  if (v === null || v === undefined) return null;

  // se vier como string com vírgula, troca pra ponto
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);

  return Number.isFinite(n) ? n : null;
}

function extrairCoordsDoTexto(txt) {
  const s = String(txt || "").toUpperCase();

  // pega números com ponto OU vírgula (ex: -15.123 ou -15,123)
  const mLat = s.match(/LAT\s*:\s*(-?\d+(?:[.,]\d+)?)/);
  const mLng = s.match(/LNG\s*:\s*(-?\d+(?:[.,]\d+)?)/);

  const lat = mLat ? toNumberCoord(mLat[1]) : null;
  const lng = mLng ? toNumberCoord(mLng[1]) : null;

  if (lat === null || lng === null) return null;
  return { lat, lng };
}

// deixa a máquina com lat/lng SEMPRE coerentes
function normalizarGPSMaquina(m) {
  if (!m) return m;

  // tenta usar lat/lng atuais
  let lat = toNumberCoord(m.lat);
  let lng = toNumberCoord(m.lng);

  // se não tiver, tenta extrair do endereço (LAT: ... LNG: ...)
  if (lat === null || lng === null) {
    const coords = extrairCoordsDoTexto(m.endereco || "");
    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
    }
  }

  // aplica de volta já corrigido
  m.lat = lat;
  m.lng = lng;

  return m;
}



// --- CADASTRO: pega GPS e guarda pro salvarMaquina ---
async function pegarLocalizacaoCadastro() {
  const campo = document.getElementById("endereco");
  if (!campo) return;

  campo.value = "📡 Pegando GPS...";
  try {
    const coords = await pegarGPS();
    const lat = coords.latitude;
    const lng = coords.longitude;

    cadastroGeoTemp = { lat, lng };
    campo.value = textoGeo(lat, lng);

    alert("✅ Localização capturada! Agora é só clicar em 'Salvar Máquina'.");
  } catch (e) {
    cadastroGeoTemp = null;
    campo.value = "";
    alert("❌ Não consegui pegar o GPS. Autorize a localização no navegador.");
  }
}


// =====================
// 📍 GPS PRECISO (High Accuracy + estabilização)
// =====================
function obterLocalizacaoPrecisa({
  maxAccuracy = 10,
  timeoutMs = 15000,
  maxAgeMs = 0,
  debug = false
} = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Geolocalização não suportada neste navegador."));
    }

    const inicio = Date.now();
    let melhor = null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;

        if (!melhor || accuracy < melhor.accuracy) {
          melhor = { latitude, longitude, accuracy, pos };
          if (debug) console.log("📍 GPS update:", accuracy.toFixed(1) + "m", latitude, longitude);
        }

        if (accuracy <= maxAccuracy) {
          navigator.geolocation.clearWatch(watchId);
          return resolve({ ...melhor, ok: true });
        }

        if (Date.now() - inicio >= timeoutMs) {
          navigator.geolocation.clearWatch(watchId);
          if (!melhor) return reject(new Error("Não conseguiu obter localização."));
          return resolve({ ...melhor, ok: false, warning: "Não atingiu a precisão desejada." });
        }
      },
      (err) => {
        navigator.geolocation.clearWatch(watchId);
        reject(err);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maxAgeMs }
    );
  });
}


function setTextoLocalizacaoUI({ lat, lng, accuracy }) {
  const texto = `LAT:${Number(lat).toFixed(6)} | LNG:${Number(lng).toFixed(6)} | ±${Number(accuracy ?? 0).toFixed(1)}m`;

  // ✅ seu campo REAL do detalhe
  const det = document.getElementById("detEndereco");
  if (det) {
    det.value = texto;
    return;
  }

  // ✅ sua aba de localização (se tiver um lugar pra mostrar)
  const localP = document.getElementById("local");
  if (localP) {
    localP.textContent = texto;
    return;
  }

  // se não tiver tela aberta, não faz nada (sem warning)
}


// =====================
// 📍 BUSCAR LOCALIZAÇÃO (GPS) — COMPLETA
// - pega GPS "mais preciso possível" (watchPosition)
// - escreve no campo da UI (detEndereco / local / localizacaoTexto)
// - salva na máquina selecionada
// - BLOQUEIA salvar se accuracy estiver ruim (ajuste o limite)
// =====================
async function buscarLocalizacaoGPS({
  maxAccuracy = 10,        // alvo: quando atingir <= isso, para e retorna
  timeoutMs = 20000,       // espera até 20s
  naoSalvarAcimaDe = 25,   // ✅ NÃO salva se accuracy > 25m (ajuste: 15/10/5)
  debug = true
} = {}) {
  try {
    // (1) pega a melhor localização possível
    const r = await obterLocalizacaoPrecisa({
      maxAccuracy,
      timeoutMs,
      maxAgeMs: 0,
      debug
    });

    // (2) texto padrão
    const texto = `LAT:${Number(r.latitude).toFixed(6)} | LNG:${Number(r.longitude).toFixed(6)} | ±${Number(r.accuracy).toFixed(1)}m`;

    // (3) atualiza UI (sem warnings)
    // prioridade: tela detalhe
    const det = document.getElementById("detEndereco");
    if (det) det.value = texto;

    // fallback: algum lugar na aba de localização
    const localP = document.getElementById("local");
    if (!det && localP) localP.textContent = texto;

    // fallback extra (se você tiver algum desses IDs)
    const elExtra =
      document.getElementById("localizacaoTexto") ||
      document.getElementById("txtLocalizacao") ||
      document.getElementById("enderecoLocalizacao") ||
      document.querySelector("[data-localizacao]");
    if (!det && !localP && elExtra) {
      if ("value" in elExtra) elExtra.value = texto;
      else elExtra.textContent = texto;
    }

    // (4) define qual máquina salvar:
    // 1º: maquinaSelecionadaNumero (se você usa isso)
    // 2º: detNumero (tela detalhe)
    // 3º: locNum (aba localização)
    const numSel = String(
      window.maquinaSelecionadaNumero ||
      document.getElementById("detNumero")?.value ||
      document.getElementById("locNum")?.value ||
      ""
    ).trim().toUpperCase();

    if (!numSel) {
      alert(
        (r.ok ? "✅ GPS OK!" : "⚠️ GPS OK, mas não ficou ideal.") +
        `\n\n${texto}`
      );
      return r;
    }

    const m = (window.maquinas || maquinas || []).find(x =>
      String(x.numero || "").trim().toUpperCase() === numSel
    );

    if (!m) {
      alert("⚠️ Peguei o GPS, mas não achei a máquina para salvar (JB " + numSel + ").");
      return r;
    }

    // (5) trava: não salva se estiver muito impreciso
    if (Number(r.accuracy) > Number(naoSalvarAcimaDe)) {
      alert(
        `❌ GPS ainda impreciso (±${Number(r.accuracy).toFixed(1)}m).\n\n` +
        `Não vou salvar pra não gravar ponto errado.\n\n` +
        `✅ Dica: teste no celular com "Localização precisa" ligada.\n\n` +
        `${texto}`
      );
      return r;
    }

    // (6) salva na máquina
    m.lat = r.latitude;
    m.lng = r.longitude;
    m.gpsAccuracy = r.accuracy;
    m.gpsUpdatedAt = new Date().toISOString();
    m.endereco = texto; // opcional (você já usa)

    // (7) persiste
    await salvarNoFirebase(true);

    try { listarMaquinas(); } catch {}
    try { atualizarStatus(); } catch {}

    alert(
      (r.ok ? "✅ GPS SALVO com boa precisão!" : "⚠️ GPS SALVO, mas não ficou ideal.") +
      `\n\n${texto}`
    );

    return r;

  } catch (e) {
    console.error("buscarLocalizacaoGPS erro:", e);

    const msg = String(e?.message || e);

    if (msg.toLowerCase().includes("permission")) {
      alert("❌ Permissão de localização negada.");
      return null;
    }
    if (msg.includes("Only secure origins") || msg.toLowerCase().includes("secure")) {
      alert("❌ GPS precisa rodar em HTTPS (ou localhost).");
      return null;
    }

    alert("❌ Não consegui obter o GPS.\n\n" + msg);
    return null;
  }
}

window.buscarLocalizacaoGPS = buscarLocalizacaoGPS;



// --- DETALHE: pega GPS e salva direto na máquina (ADMIN) ---
// ✅ versão precisa (espera estabilizar)
async function atualizarLocalizacaoDetalhe() {
  const numero = (document.getElementById("detNumero")?.value || "").trim().toUpperCase();
  if (!numero) return alert("❌ Selecione o número da máquina.");

  const m = maquinas.find(x => String(x.numero || "").toUpperCase() === numero);
  if (!m) return alert("❌ Máquina não encontrada.");

  try {
    const r = await obterLocalizacaoPrecisa({
      maxAccuracy: 10,   // tente 10. se quiser forçar: 5 (vai falhar mais)
      timeoutMs: 20000,  // 20s ajuda a estabilizar
      maxAgeMs: 0,
      debug: true
    });

    const lat = r.latitude;
    const lng = r.longitude;

    // ✅ salva no padrão do seu sistema
    m.lat = lat;
    m.lng = lng;
    m.gpsAccuracy = r.accuracy;
    m.gpsUpdatedAt = new Date().toISOString();

    const texto = `LAT:${lat.toFixed(6)} | LNG:${lng.toFixed(6)} | ±${r.accuracy.toFixed(1)}m`;

    const campo = document.getElementById("detEndereco");
    if (campo) campo.value = texto;

    // opcional manter também em endereco
    m.endereco = texto;

    await salvarNoFirebase(true);

    try { listarMaquinas(); } catch {}
    try { atualizarStatus(); } catch {}

    alert(
      (r.ok ? "✅ Localização atualizada com boa precisão!" : "⚠️ Localização salva, mas precisão não ficou ideal.") +
      `\n\nPrecisão: ${r.accuracy.toFixed(1)}m`
    );

  } catch (err) {
    console.error("atualizarLocalizacaoDetalhe erro:", err);
    alert("❌ Não consegui pegar o GPS.\n\n" + (err?.message || err));
  }
}
window.atualizarLocalizacaoDetalhe = atualizarLocalizacaoDetalhe;



// --- ABA LOCALIZAÇÃO: auto preencher ---
function autoLocalPorNumero() {
  const num = (document.getElementById("locNum")?.value || "").trim().toUpperCase();
  const estabField = document.getElementById("locEstab");
  const localP = document.getElementById("local");

  if (document.getElementById("locNum")) document.getElementById("locNum").value = num;

  if (!num) {
    if (estabField) estabField.value = "";
    if (localP) localP.textContent = "";
    return;
  }

  const m = maquinas.find(x => String(x.numero).toUpperCase() === num);
  if (m) {
    if (estabField) estabField.value = (m.estab || "").toUpperCase();
    if (localP) localP.innerHTML = `📌 Selecionado: <b>${m.estab}</b> (JB Nº ${m.numero})`;
  } else {
    if (estabField) estabField.value = "";
    if (localP) localP.textContent = "❌ Máquina não encontrada.";
  }
}

function autoLocalPorEstab() {
  const estab = (document.getElementById("locEstab")?.value || "").trim().toUpperCase();
  const numField = document.getElementById("locNum");
  const localP = document.getElementById("local");

  if (document.getElementById("locEstab")) document.getElementById("locEstab").value = estab;

  if (!estab) {
    if (numField) numField.value = "";
    if (localP) localP.textContent = "";
    return;
  }

  const m = maquinas.find(x => String(x.estab || "").toUpperCase() === estab);
  if (m) {
    if (numField) numField.value = String(m.numero || "").toUpperCase();
    if (localP) localP.innerHTML = `📌 Selecionado: <b>${m.estab}</b> (JB Nº ${m.numero})`;
  } else {
    if (numField) numField.value = "";
    if (localP) localP.textContent = "❌ Estabelecimento não encontrado.";
  }
}

// --- abre a localização salva da máquina ---
function abrirLocalizacaoMaquina() {
  const localP = document.getElementById("local");
  const num = (document.getElementById("locNum")?.value || "").trim().toUpperCase();
  const estab = (document.getElementById("locEstab")?.value || "").trim().toUpperCase();

  const m =
    maquinas.find(x => String(x.numero).toUpperCase() === num) ||
    maquinas.find(x => String(x.estab || "").toUpperCase() === estab);

  if (!m) {
    if (localP) localP.textContent = "❌ Selecione uma máquina válida.";
    return;
  }

  if (m.lat == null || m.lng == null) {
    if (localP) {
      localP.innerHTML = `❌ Essa máquina ainda não tem GPS salvo.<br>Abra a máquina em "Máquinas Cadastradas" e clique em "Atualizar Localização (ADMIN)".`;
    }
    return;
  }

  if (localP) {
    localP.innerHTML = `
      ✅ Localização salva de <b>${m.estab}</b> (JB Nº ${m.numero})<br>
      ${textoGeo(Number(m.lat), Number(m.lng))}<br><br>
      
    `;
  }
}



function mostrarPainelLocal(m) {
  const painel = document.getElementById("painelLocal");
  if (!painel) return;

  if (m.lat == null || m.lng == null) {
    painel.innerHTML = `❌ <b>${m.estab}</b> (JB Nº ${m.numero}) ainda não tem GPS salvo.`;
    return;
  }

  painel.innerHTML = `
    <div style="background:#0f172a; padding:12px; border-radius:12px;">
      <b>📌 ${String(m.estab).toUpperCase()}</b><br>
      JB Nº <b>${String(m.numero).toUpperCase()}</b><br><br>

      Lat: ${Number(m.lat).toFixed(6)}<br>
      Lng: ${Number(m.lng).toFixed(6)}<br><br>

      <button type="button" onclick="abrirNoMaps('${m.lat}', '${m.lng}')">
  📍 Abrir no Google Maps
</button>

    </div>
  `;
}

// chama quando abre a aba "localizacao"
function listarLocaisSalvos() {
  const ul = document.getElementById("listaLocais");
  const painel = document.getElementById("painelLocal");
  if (!ul) return;

  ul.innerHTML = "";
  if (painel) painel.innerHTML = "";

  // só máquinas que têm lat/lng
  const comGPS = maquinas.filter(m => m.lat != null && m.lng != null);

  if (!comGPS.length) {
    ul.innerHTML = "<li>❌ Nenhuma localização salva ainda (cadastre e pegue o GPS).</li>";
    return;
  }

  // ordena por nome do estab
  comGPS.sort((a, b) => String(a.estab).localeCompare(String(b.estab)));

  comGPS.forEach((m) => {
    const li = document.createElement("li");
    li.style.cursor = "pointer";
    li.innerHTML = `📍 <b>${String(m.estab).toUpperCase()}</b> — JB Nº ${String(m.numero).toUpperCase()}`;
    li.onclick = () => mostrarPainelLocal(m);
    ul.appendChild(li);
  });
}

function ocAutoPorNumero() {
  const num = (document.getElementById("ocNum")?.value || "").trim().toUpperCase();
  const ocNum = document.getElementById("ocNum");
  const ocEstab = document.getElementById("ocEstab");

  if (ocNum) ocNum.value = num;

  if (!num) {
    if (ocEstab) ocEstab.value = "";
    return;
  }

  const m = maquinas.find(x => String(x.numero).toUpperCase() === num);
  if (m) {
    if (ocEstab) ocEstab.value = (m.estab || "").toUpperCase();
  } else {
    if (ocEstab) ocEstab.value = "❌ MÁQUINA NÃO ENCONTRADA";
  }
}

function salvarOcorrencia() {
  const num = (document.getElementById("ocNum")?.value || "").trim().toUpperCase();
  const estab = (document.getElementById("ocEstab")?.value || "").trim().toUpperCase();
  const obs = (document.getElementById("ocObs")?.value || "").trim();

  if (!num) return alert("❌ Digite o número da máquina");
  if (!estab || estab.includes("NÃO ENCONTRADA")) return alert("❌ Máquina não encontrada");
  if (!obs) return alert("❌ Escreva a observação da ocorrência");

  ocorrencias.push({
    id: Date.now(),
    numero: num,
    estab: estab,
    obs: obs,
    data: new Date().toISOString(),
  });


  function isoLocalAgora() {
  const now = new Date();
  // ajusta para horário local e remove o "Z" (UTC)
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19); // "YYYY-MM-DDTHH:mm:ss"
}
  
  salvarNoFirebase();

    const msg =
`🚨 NOVA OCORRÊNCIA
🏢 ${estab}
🎰 JB Nº ${num}
📝 ${obs}
🕒 ${new Date().toLocaleString("pt-BR")}`;

  avisarTodosColaboradores(msg);


  document.getElementById("ocNum").value = "";
  document.getElementById("ocEstab").value = "";
  document.getElementById("ocObs").value = "";

  listarOcorrencias();
  alert("✅ Ocorrência salva!");
}

function listarOcorrencias() {
  const tela = document.getElementById("ocorrencias") || document;

  let ul = document.getElementById("listaOcorrencias");
  if (!ul) ul = tela.querySelector?.("[data-oc-lista]") || null;

  if (!ul) {
    console.error("❌ listarOcorrencias: não achei o UL da lista.", {
      temTelaOc: !!document.getElementById("ocorrencias"),
      idsPossiveis: ["#listaOcorrencias", "[data-oc-lista]"]
    });
    return;
  }

  ul.innerHTML = "";

  const lista = Array.isArray(ocorrencias) ? ocorrencias : [];

  if (!lista.length) {
    ul.innerHTML = "<li>✅ Nenhuma ocorrência pendente</li>";
    return;
  }

  const ordenadas = [...lista].sort((a, b) => new Date(b.data) - new Date(a.data));

  ordenadas.forEach((o) => {
    const d = new Date(o.data);
    const li = document.createElement("li");

    const m = (maquinas || []).find(x =>
      String(x.numero).toUpperCase() === String(o.numero).toUpperCase()
    );

    const lat = m ? toNumberCoord(m.lat) : null;
    const lng = m ? toNumberCoord(m.lng) : null;
    const temGPS = (lat !== null && lng !== null);

    const btnLocal = temGPS
      ? `
        <button type="button" style="margin-top:10px;width:100%;padding:14px 12px;border:none;border-radius:12px;background:#38bdf8;color:#0b1220;font-weight:800;font-size:16px;line-height:1;text-align:center;"
          onclick="abrirNoMaps('${lat}', '${lng}')">
          📍 Abrir Localização
        </button>
      `
      : `
        <button type="button" style="margin-top:10px;width:100%;padding:14px 12px;border:none;border-radius:12px;background:#38bdf8;color:#0b1220;font-weight:800;font-size:16px;line-height:1;text-align:center;"
          onclick="alert('❌ Essa máquina ainda não tem GPS salvo. Vá em Máquinas Cadastradas e clique em Buscar Localização (GPS).')">
          📍 Abrir Localização
        </button>
      `;

    li.style.padding = "12px";
    li.style.borderRadius = "10px";
    li.style.background = "#0f172a";
    li.style.marginTop = "10px";

    li.innerHTML = `
      <b>${o.estab}</b> — JB Nº <b>${o.numero}</b><br>
      <span style="opacity:.85;">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</span><br><br>
      <div style="white-space:pre-wrap; opacity:.95;">${o.obs}</div>
      <br>
      ${btnLocal}
      <button type="button"
        style="margin-top:10px;width:100%;padding:14px 12px;border:none;border-radius:12px;background:#22c55e;color:#0b1220;font-weight:800;font-size:16px;line-height:1;text-align:center;"
        onclick="concluirOcorrencia(${o.id})">
        ✅ Concluído
      </button>
    `;

    ul.appendChild(li);
  });
}
window.listarOcorrencias = listarOcorrencias;


function abrirOcorrencias() {
  if (!exigirAdmin()) return;
  abrir("ocorrencias");
  setTimeout(() => {
    listarOcorrencias();
    atualizarAlertaOcorrencias();
  }, 0);
}
window.abrirOcorrencias = abrirOcorrencias;



function concluirOcorrencia(id) {
  const ok = confirm("Marcar como concluído e remover do sistema?");
  if (!ok) return;

  ocorrencias = ocorrencias.filter(o => o.id !== id);
  salvarNoFirebase();

  listarOcorrencias();
  atualizarAlertaOcorrencias();
}

async function apagarMaquina() {
  if (!exigirAdmin()) return; // ✅ só isso, sem pedir senha

  const numero = (document.getElementById("detNumero")?.value || "").trim().toUpperCase();
  if (!numero) return alert("❌ Selecione uma máquina para apagar.");

  const idx = maquinas.findIndex(m => String(m.numero).toUpperCase() === numero);
  if (idx === -1) return alert("❌ Máquina não encontrada.");

  const m = maquinas[idx];

  const ok = confirm(`Apagar ${m.estab} (JB Nº ${m.numero})?\nIsso apaga os acertos também.`);
  if (!ok) return;

  maquinas.splice(idx, 1);

  const estabKey = String(m.estab || "").toUpperCase().trim();
  acertos = acertos.filter(a => String(a.estab || "").toUpperCase().trim() !== estabKey);

  salvarNoFirebase();
  atualizarAlertaOcorrencias();

  alert("🗑 Máquina apagada com sucesso!");

  if (typeof listarMaquinas === "function") listarMaquinas();
  if (typeof listarLocaisSalvos === "function") listarLocaisSalvos();

  voltar();
}


async function abrirHistoricoVendas() {
  if (!exigirAdmin()) return; // ✅ sem pedir senha extra

  abrir("historicoVendas");

  const ini = document.getElementById("hvInicio");
  const fim = document.getElementById("hvFim");

  if (ini && fim && !ini.value && !fim.value) {
    const hoje = new Date();
    const d7 = new Date();
    d7.setDate(hoje.getDate() - 7);

    ini.value = d7.toISOString().slice(0, 10);
    fim.value = hoje.toISOString().slice(0, 10);
  }

  renderHistoricoVendas(false);
}


function renderHistoricoVendas(diario) {
  const out = document.getElementById("hvResultado");
  const ini = document.getElementById("hvInicio")?.value;
  const fim = document.getElementById("hvFim")?.value;
  if (!out) return;

  if (!ini || !fim) {
    out.innerHTML = `<div style="padding:12px; border-radius:12px; background:#0f172a;">
      ❌ Selecione <b>Data Inicial</b> e <b>Data Final</b>.
    </div>`;
    return;
  }

  // período inclusivo (00:00 até 23:59)
  const start = new Date(ini + "T00:00:00");
  const end = new Date(fim + "T23:59:59.999");

  const filtrados = (acertos || []).filter(a => {
    const d = new Date(a.data);
    return d >= start && d <= end;
  });

  if (!filtrados.length) {
    out.innerHTML = `<div style="padding:12px; border-radius:12px; background:#0f172a;">
      ✅ Nenhum acerto encontrado nesse período.
    </div>`;
    return;
  }

  let somaPix = 0;
  let somaDin = 0;

  filtrados.forEach(a => {
    somaPix += Number(a.pix || 0);
    somaDin += Number(a.dinheiro || 0);
  });

  const total = somaPix + somaDin;

  if (!diario) {
    out.innerHTML = `
      <div style="padding:12px; border-radius:12px; background:#0f172a;">
        <b>📌 Período:</b> ${formatBR(start)} até ${formatBR(end)}<br><br>
        💳 <b>Total PIX:</b> R$ ${somaPix.toFixed(2)}<br>
        💵 <b>Total Espécie:</b> R$ ${somaDin.toFixed(2)}<br>
        ✅ <b>Total Geral (PIX + Espécie):</b> R$ ${total.toFixed(2)}<br>
        <span style="opacity:.85;">Baseado nos acertos registrados.</span>
      </div>
    `;
    return;
  }

  // diário
  const porDia = new Map(); // yyyy-mm-dd -> {pix, din, total}
  filtrados.forEach(a => {
    const d = new Date(a.data);
    const key = d.toISOString().slice(0, 10);
    const pix = Number(a.pix || 0);
    const din = Number(a.dinheiro || 0);

    if (!porDia.has(key)) porDia.set(key, { pix: 0, din: 0 });
    porDia.get(key).pix += pix;
    porDia.get(key).din += din;
  });

  const diasOrdenados = [...porDia.keys()].sort();

  let html = `
    <div style="padding:12px; border-radius:12px; background:#0f172a;">
      <b>📅 Diário:</b> ${ini} até ${fim}<br><br>
      💳 <b>Total PIX:</b> R$ ${somaPix.toFixed(2)}<br>
      💵 <b>Total Espécie:</b> R$ ${somaDin.toFixed(2)}<br>
      ✅ <b>Total Geral:</b> R$ ${total.toFixed(2)}<br><br>
      <hr style="opacity:.2;">
  `;

  diasOrdenados.forEach(key => {
    const v = porDia.get(key);
    const t = v.pix + v.din;
    html += `
      <div style="padding:10px; border-radius:10px; background:#111827; margin:10px 0;">
        <b>${key.split("-").reverse().join("/")}</b><br>
        💳 PIX: R$ ${v.pix.toFixed(2)}<br>
        💵 Espécie: R$ ${v.din.toFixed(2)}<br>
        ✅ Total: R$ ${t.toFixed(2)}
      </div>
    `;
  });

  html += `</div>`;
  out.innerHTML = html;
}

function formatBR(d) {
  try {
    return new Date(d).toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
}


function pad2(n) { return String(n).padStart(2, "0"); }

// ====== CONFIG ======
const STORAGE_KEY = "maquinas"; // onde fica a lista de máquinas salvas

// Normaliza o número: tira espaços e padroniza
function normalizarNumero(num) {
  return String(num || "").trim();
}

function carregarMaquinas() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function salvarMaquinas(lista) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
}

function maquinaExiste(numero) {
  const num = normalizarNumero(numero);
  const maquinas = carregarMaquinas();
  return maquinas.some(m => normalizarNumero(m.numero) === num);
}

// ✅ 1) Verifica quando você sai do campo (onblur)
function verificarNumeroMaquina() {
  const numero = normalizarNumero(document.getElementById("numMaquina").value);

  if (!numero) return; // não faz nada se estiver vazio

  if (maquinaExiste(numero)) {
    alert("❌ Já existe uma máquina cadastrada com esse número!");
    document.getElementById("numMaquina").focus();
    document.getElementById("numMaquina").select();
  } else {
    // opcional: pode mostrar uma confirmação silenciosa
    // console.log("Número disponível:", numero);
  }
}

// ✅ 2) Salva e vai para Depósito (recadastro)
function salvarCadastroMaquina() {
  const numero = normalizarNumero(document.getElementById("numMaquina").value);

  if (!numero) {
    alert("Digite o número da máquina.");
    document.getElementById("numMaquina").focus();
    return;
  }

  // bloqueia duplicado
  if (maquinaExiste(numero)) {
    alert("❌ Esse número já está cadastrado. Use outro.");
    document.getElementById("numMaquina").focus();
    document.getElementById("numMaquina").select();
    return;
  }

  // cria registro mínimo
  const maquinas = carregarMaquinas();

  const novaMaquina = {
    numero: numero,
    criadoEm: new Date().toISOString(),
    status: "deposito" // já marca como indo pro depósito
  };

  maquinas.push(novaMaquina);
  salvarMaquinas(maquinas);

  // (opcional) guardar qual máquina ficou "selecionada" pro recadastro
  localStorage.setItem("maquinaSelecionada", numero);

  alert("✅ Máquina salva! Indo para Depósito...");

  // ir direto pro Depósito
  abrirDeposito();
}

// ✅ 3) Função pra trocar de tela/aba/box pro Depósito
function abrirDeposito() {
  // EXEMPLO: se você usa divs com class "escondido"
  // ajuste os IDs conforme o seu site

  const telaCadastro = document.getElementById("cadastro");
  const telaDeposito = document.getElementById("deposito"); // <--- seu ID do depósito

  if (telaCadastro) telaCadastro.classList.add("escondido");
  if (telaDeposito) telaDeposito.classList.remove("escondido");

  // se você tiver título/rotina ao abrir o depósito, pode chamar aqui também:
  // carregarTelaDeposito();
}


function setPeriodoMesAtual() {
  const ini = document.getElementById("histIni");
  const fim = document.getElementById("histFim");
  if (!ini || !fim) return;

  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = hoje.getMonth(); // 0-11

  const primeiroDia = new Date(y, m, 1);
  const ultimoDia = new Date(y, m + 1, 0); // último dia do mês

  ini.value = `${y}-${pad2(m + 1)}-${pad2(primeiroDia.getDate())}`;
  fim.value = `${y}-${pad2(m + 1)}-${pad2(ultimoDia.getDate())}`;
}

// pega data do input e monta um Date válido no fuso local
function parseDataInput(v) {
  // v vem tipo "2026-01-09"
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function gerarRelatorioVendas() {
  const iniEl = document.getElementById("histIni");
  const fimEl = document.getElementById("histFim");
  const saida = document.getElementById("histResultado");
  if (!iniEl || !fimEl || !saida) return;

  if (!iniEl.value || !fimEl.value) {
    alert("❌ Selecione data inicial e final.");
    return;
  }

  const dtIni = parseDataInput(iniEl.value);
  const dtFim = parseDataInput(fimEl.value);

  // ✅ inclui o dia final inteiro (23:59:59)
  dtFim.setHours(23, 59, 59, 999);

  // filtra acertos pelo período
  const lista = (acertos || []).filter(a => {
    const d = new Date(a.data);
    return d >= dtIni && d <= dtFim;
  });

  let totalPix = 0;
  let totalDin = 0;
  let totalEmpresa = 0;
  let totalCliente = 0;
  let totalRelogio = 0;

  lista.forEach(a => {
    totalPix += Number(a.pix || 0);
    totalDin += Number(a.dinheiro || 0);
    totalEmpresa += Number(a.empresa || 0);
    totalCliente += Number(a.cliente || 0);
    totalRelogio += Number(a.totalRelogio || 0);
  });

  saida.innerHTML = `
    <div style="background:#0f172a; padding:12px; border-radius:12px;">
      <b>📅 Período:</b> ${iniEl.value} até ${fimEl.value}<br><br>

      🕒 <b>Total pelo relógio:</b> R$ ${totalRelogio.toFixed(2)}<br>
      💳 <b>Total PIX:</b> R$ ${totalPix.toFixed(2)}<br>
      💵 <b>Total Espécie:</b> R$ ${totalDin.toFixed(2)}<br><br>

      🏢 <b>Total Empresa:</b> R$ ${totalEmpresa.toFixed(2)}<br>
      👤 <b>Total Cliente:</b> R$ ${totalCliente.toFixed(2)}<br><br>

      <b>✅ Acertos no período:</b> ${lista.length}
    </div>
  `;
}


function limparHistoricoVendas() {
  const ini = document.getElementById("histIni");
  const fim = document.getElementById("histFim");
  const saida = document.getElementById("histResultado");

  if (ini) ini.value = "";
  if (fim) fim.value = "";

  if (saida) {
    saida.innerHTML = `
      <div style="background:#0f172a; padding:12px; border-radius:12px;">
        ✅ Selecione a <b>Data Inicial</b> e <b>Data Final</b> e clique em <b>Gerar Relatório</b>.
      </div>
    `;
  }
}

async function fazerLogin(e) {
  e?.preventDefault?.();

  console.log("1) clique login");
  mostrarLoading(true);

  try {
    console.log("2) antes do signIn");
    // AQUI seu signIn (email/senha ou anon)
    // await signInWithEmailAndPassword(auth, email, senha);
    // OU await signInAnonymously(auth);

    console.log("3) depois do signIn ✅");

    console.log("4) antes de carregar empresas");
    await carregarEmpresas(); // ou a função que busca Firestore
    console.log("5) depois de carregar empresas ✅");

  } catch (err) {
    console.error("ERRO no login:", err);
    alert(err?.message || err);
  } finally {
    console.log("6) finally -> desliga loading");
    mostrarLoading(false);
  }
}



function pubOcAutoPorNumero() {
  const numEl = document.getElementById("pubOcNum");
  const estabEl = document.getElementById("pubOcEstab");

  const num = (numEl?.value || "").trim().toUpperCase();
  if (numEl) numEl.value = num;

  if (!num) {
    if (estabEl) estabEl.value = "";
    return;
  }

  const lista = Array.isArray(window.pubMaquinas) ? window.pubMaquinas : [];

  const m = lista.find(x => String(x.numero || "").trim().toUpperCase() === num);

  if (m) {
    if (estabEl) estabEl.value = String(m.estab || "").toUpperCase();
  } else {
    if (estabEl) estabEl.value = "❌ MÁQUINA NÃO ENCONTRADA";
  }
}
window.pubOcAutoPorNumero = pubOcAutoPorNumero;


window.pubMaquinas = []; // cache das máquinas da empresa selecionada

async function carregarMaquinasPublicasDaEmpresa(empId) {
  empId = String(empId || "").trim().toUpperCase();
  window.pubMaquinas = [];

  if (!empId) return [];

  try {
    await ensureAuth();

    // ✅ aqui você precisa ajustar APENAS o caminho conforme sua estrutura
    // Opção A (mais comum no seu padrão): /empresas/{EMP}/dados/app  (maquinas dentro)
    const refApp = doc(db, "empresas", empId, "dados", "app");
    const snap = await getDoc(refApp);

    if (!snap.exists()) {
      console.warn("⚠️ app não existe para empresa:", empId);
      return [];
    }

    const data = snap.data() || {};

    // ✅ tenta achar onde você guarda as máquinas
    // ajuste se no seu app está em outro nome
    const lista =
  (Array.isArray(data.maquinas) && data.maquinas) ||
  (Array.isArray(data.maquinasCadastradas) && data.maquinasCadastradas) ||
  (Array.isArray(data.listaMaquinas) && data.listaMaquinas) ||
  [];

    window.pubMaquinas = lista;
    console.log("✅ Máquinas públicas carregadas:", empId, lista.length);
    return lista;

  } catch (e) {
    console.error("❌ carregarMaquinasPublicasDaEmpresa:", e);
    window.pubMaquinas = [];
    return [];
  }
}
window.carregarMaquinasPublicasDaEmpresa = carregarMaquinasPublicasDaEmpresa;

async function onPubEmpresaChange() {
  const sel = document.getElementById("pubOcEmpresa");
  const numEl = document.getElementById("pubOcNum");
  const estabEl = document.getElementById("pubOcEstab");

  const empId = String(sel?.value || "").trim().toUpperCase();

  if (numEl) numEl.disabled = !empId;

  if (estabEl) estabEl.value = "";
  if (numEl) numEl.value = "";

  if (!empId) {
    window.pubMaquinas = [];
    return;
  }

  await carregarMaquinasPublicasDaEmpresa(empId);
}
window.onPubEmpresaChange = onPubEmpresaChange;


window.addEventListener("DOMContentLoaded", async () => {
  // carrega empresas no select público (você já tem)
  try { await carregarEmpresasPublicasFirestore(); } catch {}

  const sel = document.getElementById("pubOcEmpresa");
  const numEl = document.getElementById("pubOcNum");

  if (sel) sel.addEventListener("change", onPubEmpresaChange);
  if (numEl) numEl.addEventListener("input", pubOcAutoPorNumero);

  // se já vier selecionado por algum motivo, carrega máquinas
  if (sel?.value) await onPubEmpresaChange();
});


function limparCamposLogin() {
  const u = document.getElementById("loginUser");
  const p = document.getElementById("loginSenha");
  if (u) u.value = "";
  if (p) p.value = "";
  if (u) u.focus();
}



// =====================
// ✅ FIX LOGIN (IDs + escopo global)
// =====================

function pegarValorPrimeiroIdQueExiste(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return (el.value || "").trim();
  }
  return "";
}


function pegarTelefoneDaMaquina(m) {
  if (!m) return "";
  if (m.foneFormatado) return String(m.foneFormatado);
  const nums = String((m.ddd || "") + (m.tel || "")).replace(/\D/g, "");
  return nums ? formatarTelefoneBR(nums) : "";
}



function pegarNumeroWhatsDoDetalhe() {
  const el = document.getElementById("detFone");
  const tel = (el?.value || "").trim();

  // só números (remove ( ) espaço - etc)
  let nums = tel.replace(/\D/g, "");

  // se o usuário digitou com 55 (13 dígitos), tira o 55
  if (nums.startsWith("55") && nums.length >= 12) nums = nums.slice(2);

  // valida mínimo (DDD + número)
  if (nums.length < 10) return "";
  return nums.slice(0, 11); // limita a 11 (DDD + 9)
}

function ligarTelefone() {
  const numero = pegarNumeroWhatsDoDetalhe();
  if (!numero) return alert("❌ Informe um telefone válido no campo do detalhe.");
  window.location.href = "tel:" + numero;
}

let __zapAbrindo = false;

function abrirWhats(ev){
  if (ev){ ev.preventDefault(); ev.stopPropagation(); }

  let tel = (document.getElementById("detFone")?.value || "").trim();

  // pega só numeros
  tel = tel.replace(/\D/g, "");
  if (!tel) return alert("❌ Informe um telefone.");

  // se tiver 55 e for grande, mantém. se não tiver, coloca.
  if ((tel.length === 10 || tel.length === 11)) tel = "55" + tel;

  const estab = (document.getElementById("detEstab")?.value || "").trim();
  const num   = (document.getElementById("detNumero")?.value || "").trim();

  const msg = `Olá! Máquina ${num} (${estab}).`;

  abrirWhatsTexto(tel, msg);
}



function avisarTodosColaboradores(msg) {
  const lista = listarColaboradoresComWhats();

  if (!lista.length) {
    alert("❌ Nenhum colaborador com Whats válido cadastrado.");
    return;
  }

  // overlay
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.65)";
  overlay.style.zIndex = "999999";              // bem alto
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.pointerEvents = "auto";         // garante clique

  // caixa
  const box = document.createElement("div");
  box.style.width = "360px";
  box.style.maxWidth = "92%";
  box.style.background = "#0f172a";
  box.style.padding = "14px";
  box.style.borderRadius = "14px";
  box.style.color = "#fff";
  box.style.pointerEvents = "auto";

  const titulo = document.createElement("div");
  titulo.style.fontWeight = "900";
  titulo.style.marginBottom = "10px";
  titulo.textContent = "Enviar ocorrência para:";
  box.appendChild(titulo);

  // botões dos colaboradores
  lista.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.width = "100%";
    btn.style.padding = "12px";
    btn.style.margin = "6px 0";
    btn.style.borderRadius = "10px";
    btn.style.border = "none";
    btn.style.cursor = "pointer";
    btn.style.background = "#22c55e";
    btn.style.fontWeight = "900";
    btn.textContent = `📲 ${c.nome} (${c.whats})`;

    btn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();

  const tel = normalizarWhats(c.whats);
  if (!tel) return alert("❌ Whats inválido no cadastro.");

  // ✅ abre Whats do jeito mais compatível (PC + celular)
  let ok = false;

ok = abrirWhatsTexto(tel, msg);


if (!ok) alert("❌ Não consegui abrir o WhatsApp.");


  setTimeout(() => overlay.remove(), 150);
});

    box.appendChild(btn);
  });

  // botão fechar
  const fechar = document.createElement("button");
  fechar.type = "button";
  fechar.style.width = "100%";
  fechar.style.padding = "12px";
  fechar.style.marginTop = "10px";
  fechar.style.borderRadius = "10px";
  fechar.style.border = "none";
  fechar.style.cursor = "pointer";
  fechar.style.background = "#38bdf8";
  fechar.style.fontWeight = "900";
  fechar.textContent = "Fechar";

  fechar.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    overlay.remove();
  });

  box.appendChild(fechar);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // clicar fora da caixa fecha
  overlay.addEventListener("click", () => overlay.remove());
  box.addEventListener("click", (e) => e.stopPropagation());
}




// =====================
// 🔐 CONFIRMAÇÃO ADMIN (usuário + senha)
// =====================
function pedirCredenciaisAdmin() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,.65)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    const box = document.createElement("div");
    box.style.width = "340px";
    box.style.maxWidth = "92%";
    box.style.background = "#1f2a3a";
    box.style.borderRadius = "12px";
    box.style.padding = "16px";
    box.style.color = "#fff";
    box.style.boxShadow = "0 10px 25px rgba(0,0,0,.35)";

    box.innerHTML = `
      <h3 style="margin:0 0 10px 0;">🔐 Confirmação do ADMIN</h3>
      <p style="margin:0 0 10px 0; opacity:.9;">Digite usuário e senha:</p>

      <label style="display:block; margin:0 0 6px;">Usuário</label>
      <input id="admUserConfirm" type="text" placeholder="admin"
        autocomplete="off"
        style="width:100%; padding:10px; border-radius:10px; border:none; outline:none; margin-bottom:10px;">

      <label style="display:block; margin:0 0 6px;">Senha</label>
      <input id="admPassConfirm" type="password" placeholder="••••••••"
        autocomplete="new-password"
        style="width:100%; padding:10px; border-radius:10px; border:none; outline:none; margin-bottom:12px;">

      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button id="admCancel"
          style="padding:10px 12px; border-radius:10px; border:none; cursor:pointer;">
          Cancelar
        </button>
        <button id="admOk"
          style="padding:10px 12px; border-radius:10px; border:none; cursor:pointer; background:#2ec55e; color:#0b1a12;">
          Confirmar
        </button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const userEl = box.querySelector("#admUserConfirm");
    const passEl = box.querySelector("#admPassConfirm");
    const btnOk = box.querySelector("#admOk");
    const btnCancel = box.querySelector("#admCancel");

    const fechar = (valor) => {
      document.body.removeChild(overlay);
      resolve(valor);
    };

    // Cancelar
    btnCancel.onclick = () => fechar(null);

    // Validar as credenciais
    btnOk.onclick = () => {
  const user = (userEl.value || "").trim().toLowerCase();
  const senha = (passEl.value || "").trim();

  const u = validarCredenciaisAdmin({ user, senha });
  if (u) {
    alert("✅ Credenciais corretas! Acesso concedido.");
    fechar(true);
  } else {
    alert("❌ Credenciais incorretas!");
    fechar(false);
  }
};
  });
}


function validarCredenciaisAdmin({ user, senha }) {
  user = String(user || "").trim().toLowerCase();
  senha = String(senha || "").trim();

  const candidatos = (usuarios || []).filter(x => {
    const t = String(x.tipo || "").toUpperCase();

    const okTipo = (t === "ADMIN" || t === "MASTER");
    const okLogin =
      okTipo &&
      String(x.user || "").toLowerCase() === user &&
      String(x.senha || "") === senha;

    if (!okLogin) return false;

    // ADMIN normal só entra na empresa atual
    if (t === "ADMIN") {
      const empUser = String(x.empresaId || "").toUpperCase();
      const empAtual = String(empresaAtualId || "").toUpperCase();
      return empUser === empAtual;
    }

    return true; // MASTER passa
  });

  // prioridade MASTER
  const u =
    candidatos.find(x => String(x.tipo || "").toUpperCase() === "MASTER") ||
    candidatos[0] ||
    null;

  return u;
}




async function trocarSenhaAdmin() {
  if (!exigirAdmin()) return;

  const empId = String(empresaAtualId || "").trim().toUpperCase();
  if (!empId) return alert("❌ Empresa atual não definida.");

  const nova = prompt("Digite a NOVA senha do ADMIN (mínimo 4 caracteres):");
  if (nova === null) return;

  const novaLimpa = String(nova).trim();
  if (novaLimpa.length < 4) return alert("❌ Senha muito curta.");

  const confirma = prompt("Confirme a NOVA senha do ADMIN:");
  if (confirma === null) return;

  if (String(confirma).trim() !== novaLimpa) {
    alert("❌ Confirmação não bate.");
    return;
  }

  // ✅ pega o ADMIN da empresa atual
  const admin = (usuarios || []).find(u =>
    String(u.tipo || "").toUpperCase() === "ADMIN" &&
    String(u.empresaId || "").toUpperCase() === empId
  );
  if (!admin) return alert("❌ Admin não encontrado nessa empresa.");

  admin.senha = novaLimpa;

  // ✅ salva no doc da empresa
  await salvarNoFirebase(true);

  // ✅ ATUALIZA O ÍNDICE CENTRAL E FORÇA TROCA DE SENHA (senão não muda!)
  await salvarLoginIndex({
    user: admin.user,
    tipo: "ADMIN",
    empresaId: empId,
    senha: admin.senha,
    forceSenha: true
  });

  alert("✅ Senha do ADMIN alterada com sucesso!");
}
window.trocarSenhaAdmin = trocarSenhaAdmin;


async function trocarCredenciaisAdmin() {
  if (!exigirMaster()) return;

  const empId = String(empresaAtualId || "").trim().toUpperCase();
  if (!empId) return alert("❌ Empresa atual não definida.");

  const nome = prompt("Digite o NOME do novo ADMIN:");
  if (nome === null) return;
  const nomeLimpo = String(nome).trim().toUpperCase();
  if (!nomeLimpo) return alert("❌ Nome não pode ficar vazio.");

  const novoUser = prompt("Digite o USUÁRIO do novo ADMIN (ex: admin_empresa):");
  if (novoUser === null) return;
  const userLimpo = String(novoUser).trim().toLowerCase();
  if (!userLimpo) return alert("❌ Usuário não pode ficar vazio.");

  const novaSenha = prompt("Digite a SENHA do novo ADMIN (mínimo 4 caracteres):");
  if (novaSenha === null) return;
  const senhaLimpa = String(novaSenha).trim();
  if (senhaLimpa.length < 4) return alert("❌ Senha muito curta.");

  const confirma = prompt("Confirme a SENHA do novo ADMIN:");
  if (confirma === null) return;
  if (String(confirma).trim() !== senhaLimpa) return alert("❌ Confirmação não bate.");

  const idx = (usuarios || []).findIndex(u =>
    String(u.tipo || "").toUpperCase() === "ADMIN" &&
    String(u.empresaId || "").toUpperCase() === empId
  );
  if (idx === -1) return alert("❌ ADMIN não encontrado nessa empresa.");

  // guarda user antigo pra remover do índice depois
  const userAntigo = String(usuarios[idx].user || "").trim().toLowerCase();

  // impede duplicado no array da empresa
  const duplicado = (usuarios || []).some((u, i) =>
    i !== idx && String(u.user || "").toLowerCase() === userLimpo
  );
  if (duplicado) return alert("❌ Já existe outro usuário com esse login nessa empresa.");

  usuarios[idx].nome = nomeLimpo;
  usuarios[idx].user = userLimpo;
  usuarios[idx].senha = senhaLimpa;
  usuarios[idx].empresaId = empId;
  usuarios[idx].tipo = "ADMIN";

  await salvarNoFirebase(true);

  // cria/atualiza login novo e FORÇA senha
  await salvarLoginIndex({
    user: userLimpo,
    tipo: "ADMIN",
    empresaId: empId,
    senha: senhaLimpa,
    forceSenha: true
  });

  // se mudou user, apaga o antigo do índice (opcional, mas recomendado)
  if (userAntigo && userAntigo !== userLimpo) {
    try { await apagarLoginIndex(userAntigo); } catch {}
  }

  alert("✅ Credenciais do ADMIN atualizadas e salvas no banco!");
}
window.trocarCredenciaisAdmin = trocarCredenciaisAdmin;


function exportarDados() {
  const payload = {
    versao: 1,
    exportadoEm: new Date().toISOString(),
    dados: { usuarios, maquinas, acertos, ocorrencias }
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `stronda_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  alert("✅ Backup exportado!");
}

function diasEntre(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  return Math.floor((b - a) / ms);
}

function calcularVencimento(diaPagamento, refDate = new Date()) {
  const dia = Math.max(1, Math.min(28, Number(diaPagamento || 5))); // evita mês curto
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  return new Date(y, m, dia, 0, 0, 0);
}

// ✅ retorna {atrasado, diasAtraso, vencimento, bloquearAgora}
function checarPagamento(billing) {
  const hoje = new Date();

  const diaPagamento = Number(billing?.diaPagamento || 5);
  let venc = calcularVencimento(diaPagamento, hoje);

  // se ainda não chegou no vencimento desse mês, usa o vencimento do mês anterior
  if (hoje < venc) {
    const anterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    venc = calcularVencimento(diaPagamento, anterior);
  }

  const ultimoPago = billing?.ultimoPagamentoEm ? new Date(billing.ultimoPagamentoEm) : null;

  // se já pagou depois do vencimento atual, não está atrasado
  const pagoEsteCiclo = ultimoPago && ultimoPago >= venc;

  if (pagoEsteCiclo) {
    return { atrasado: false, diasAtraso: 0, vencimento: venc, bloquearAgora: false };
  }

  const diasAtraso = Math.max(0, diasEntre(venc, hoje));
  const bloquearAgora = diasAtraso >= 10; // ✅ 10 dias de atraso

  return { atrasado: diasAtraso > 0, diasAtraso, vencimento: venc, bloquearAgora };
}

function toggleSenha(id, btn){
  const input = document.getElementById(id);
  if (!input) return;

  const mostrando = input.type === "text";
  input.type = mostrando ? "password" : "text";
  btn.textContent = mostrando ? "👁️" : "🙈";
}


function importarDadosArquivo(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const obj = JSON.parse(String(reader.result || "{}"));
      const dados = obj?.dados || obj;

      if (Array.isArray(dados.usuarios)) usuarios = dados.usuarios;
      if (Array.isArray(dados.maquinas)) maquinas = dados.maquinas;
      if (Array.isArray(dados.acertos)) acertos = dados.acertos;
      if (Array.isArray(dados.ocorrencias)) ocorrencias = dados.ocorrencias;

      await salvarNoFirebase();
      atualizarAlertaOcorrencias();

      alert("✅ Dados importados e enviados pro Firebase!");
      const inp = document.getElementById("inpImportar");
      if (inp) inp.value = "";
    } catch (e) {
      alert("❌ Falha ao importar: " + (e?.message || e));
    }
  };

  reader.readAsText(file);
}



function sair() {
  pararSnapshotAtual();
  sessaoUsuario = null;
  localStorage.removeItem("sessaoUsuario");
  window.__sessao = null; // ✅
  mostrarTelaLogin();
}


// =====================
// 🏢 EMPRESAS (LISTA CENTRAL)
// =====================
async function criarEstruturaEmpresaSeNaoExistir(emp) {
  emp = String(emp || "").trim().toUpperCase();
  if (!emp) return;

  await ensureAuth();

  const ref = doc(db, "empresas", emp, "dados", "app");
  const snap = await getDoc(ref);

  // ✅ se já existe: não recria e não reindexa senha
  if (snap.exists()) return;

  // ✅ só ADMIN da empresa (MASTER é GLOBAL e fica no config/logins)
  const usuariosBase = [
    {
      id: Date.now(),
      tipo: "ADMIN",
      nome: "ADMIN",
      user: `admin_${emp.toLowerCase()}`,
      senha: "1234",
      empresaId: emp
    }
  ];

  const payload = {
    atualizadoEm: new Date().toISOString(),
    ocorrencias: [],
    maquinas: [],
    acertos: [],
    usuarios: usuariosBase,

    empresaPerfil: {
      nomeEmpresa: emp,
      adminNome: "ADMIN",
      criadoEm: new Date().toISOString(),
    },

    billing: {
      diaPagamento: 5,
      ultimoPagamentoEm: new Date().toISOString(),
      bloqueado: false,
      bloqueadoEm: null,
      motivo: ""
    }
  };

  // 1) cria o doc da empresa
  await setDoc(ref, payload);

  // 2) grava SOMENTE o admin no índice central
  for (const u of usuariosBase) {
    await salvarLoginIndex({
      user: u.user,
      tipo: u.tipo,
      empresaId: u.empresaId,
      senha: u.senha,
      // ✅ como é novo, pode gravar senha; se por acaso já existir, não muda a senha
      forceSenha: false
    });
  }
}

async function repararIndiceLoginsDaEmpresa(empId) {
  empId = String(empId || "").trim().toUpperCase();
  if (!empId) return;

  await ensureAuth();

  const ref = doc(db, "empresas", empId, "dados", "app");
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const lista = Array.isArray(data.usuarios) ? data.usuarios : [];

  for (const u of lista) {
    const tipo = String(u?.tipo || "").toUpperCase();
    if (tipo === "MASTER") continue; // ✅ NUNCA reindexa master vindo de empresa

    const user = String(u?.user || "").trim().toLowerCase();
    const senha = String(u?.senha || "").trim();
    const empresaId = String(u?.empresaId || empId).trim().toUpperCase();

    if (!user || !tipo) continue;

    // ✅ NÃO muda senha de quem já existe no índice
    // (se não existir, cria; se existir, mantém senha)
    await salvarLoginIndex({
      user,
      tipo,
      empresaId,
      senha: senha || "1234",   // só serve caso seja novo e senha veio vazia
      forceSenha: false
    });
  }
}


function aplicarClassePermissaoBody() {
  document.body.classList.remove("is-admin", "is-master", "is-colab");

  const t = String(sessaoUsuario?.tipo || window.sessaoUsuario?.tipo || "").toUpperCase();

  if (t === "MASTER") {
    document.body.classList.add("is-master", "is-admin");
    return;
  }
  if (t === "ADMIN") {
    document.body.classList.add("is-admin");
    return;
  }
  if (t === "COLAB") {
    document.body.classList.add("is-colab");
  }
}
window.aplicarClassePermissaoBody = aplicarClassePermissaoBody;


async function selecionarEmpresa(emp) {
  emp = String(emp || "").trim().toUpperCase();
  if (!emp) return;

  pararSnapshotAtual();

  setEmpresaAtual(emp);
  localStorage.setItem("empresaAtualId", emp);

  firebasePronto = false;
  desabilitarBotaoLogin();

  await carregarDadosUmaVezParaLogin();

  // ✅ SEMPRE entra no app e mostra o menu
  mostrarApp();
  voltar(); // ✅ menu aparece sempre

  // ✅ se sessão é válida nessa empresa, aplica permissões e liga snapshot
  if (validarSessaoPersistida()) {
    aplicarClassePermissaoBody();
    aplicarPermissoesMenu();
    aplicarPermissoesUI();

    pararSnapshotAtual();
    __syncAtivo = false;
    await iniciarSincronizacaoFirebase();
  } else {
    // ✅ sem login: só entra “pra olhar”
    // (não aplica classe/permissão de admin)
    document.body.classList.remove("is-admin", "is-master", "is-colab");
  }

  try { listarMaquinas(); } catch {}
  try { atualizarStatus(); } catch {}
  try { listarOcorrencias(); } catch {}
  try { atualizarAlertaOcorrencias(); } catch {}
}
window.selecionarEmpresa = selecionarEmpresa;


function onlyDigits(s){ return String(s||"").replace(/\D/g,""); }

function detectarDocTipo(docNum){
  const n = onlyDigits(docNum);
  if (!n) return "";        // ✅ opcional
  if (n.length === 11) return "CPF";
  if (n.length === 14) return "CNPJ";
  return "INVALIDO";
}

function validarPreCadastro({empId, nomeEmpresa, doc, adminNome, adminUser, adminSenha, diaPagamento}){
  empId = String(empId||"").trim().toUpperCase();
  nomeEmpresa = String(nomeEmpresa||"").trim();
  doc = onlyDigits(doc);
  adminNome = String(adminNome||"").trim();
  adminUser = String(adminUser||"").trim().toLowerCase();
  adminSenha = String(adminSenha||"").trim();
  diaPagamento = Number(diaPagamento||5);

  if (!empId) return {ok:false, msg:"❌ Empresa ID é obrigatório."};
  if (!nomeEmpresa) return {ok:false, msg:"❌ Nome da empresa é obrigatório."};
  if (!adminNome) return {ok:false, msg:"❌ Nome do ADMIN é obrigatório."};
  if (!adminUser) return {ok:false, msg:"❌ Usuário do ADMIN é obrigatório."};
  if (adminSenha.length < 4) return {ok:false, msg:"❌ Senha do ADMIN mínimo 4 caracteres."};
  if (!(diaPagamento >= 1 && diaPagamento <= 28)) return {ok:false, msg:"❌ Dia de pagamento deve ser de 1 a 28."};

  // ✅ CPF/CNPJ opcional
  const docTipo = detectarDocTipo(doc);
  if (docTipo === "INVALIDO") {
    return {ok:false, msg:"❌ CPF/CNPJ inválido. Use 11 (CPF) ou 14 (CNPJ) dígitos, ou deixe em branco."};
  }

  return {
    ok:true,
    data:{ empId, nomeEmpresa, doc, docTipo, adminNome, adminUser, adminSenha, diaPagamento }
  };
}

// ✅ Nome bonito da empresa pelo ID (usa a lista central config/empresas)
async function getNomeBonitoEmpresa(empId) {
  empId = String(empId || "").trim().toUpperCase();
  if (!empId) return "";

  try {
    // cache simples 60s
    window.__cacheNomeEmpresa = window.__cacheNomeEmpresa || new Map();
    const cache = window.__cacheNomeEmpresa.get(empId);
    if (cache && (Date.now() - cache.at) < 60000) return cache.nome;

    const lista = await garantirListaEmpresas(); // [{id,nome}]
    const obj = (lista || []).find(e => String(e.id || "").toUpperCase() === empId);

    const nome = String(obj?.nome || empId).trim();
    window.__cacheNomeEmpresa.set(empId, { nome, at: Date.now() });
    return nome;
  } catch (e) {
    return empId; // fallback
  }
}

async function preCadastrarEmpresa() {
  try {
    console.log("clicou em cadastrar empresa");

    if (!exigirMaster()) return;

    const btn = document.getElementById("btnCadastrarEmpresa");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Cadastrando..."; }

    const empId = (document.getElementById("pcEmpId")?.value || "").trim().toUpperCase();
    const nomeEmpresa = (document.getElementById("pcNomeEmpresa")?.value || "").trim();
    const docNum = (document.getElementById("pcDoc")?.value || "").trim();
    const adminNome = (document.getElementById("pcAdminNome")?.value || "").trim();
    const adminUser = (document.getElementById("pcAdminUser")?.value || "").trim().toLowerCase();
    const adminSenha = (document.getElementById("pcAdminSenha")?.value || "").trim();
    const diaPagamento = Number(document.getElementById("pcDiaPagamento")?.value || 5);

    const v = validarPreCadastro({
      empId, nomeEmpresa, doc: docNum,
      adminNome, adminUser, adminSenha,
      diaPagamento
    });

    if (!v.ok) {
      alert(v.msg);
      return;
    }

    const data = v.data;

    // 1) lista central
    let lista = await garantirListaEmpresas(); // [{id,nome}]
    const idxEmp = lista.findIndex(e => String(e.id || "").toUpperCase() === data.empId);

    if (idxEmp === -1) {
      lista.push({ id: data.empId, nome: data.nomeEmpresa }); // ✅ nome real
    } else {
      lista[idxEmp].nome = data.nomeEmpresa; // atualiza nome
    }
    await salvarListaEmpresas(lista);

    // 2) cria estrutura base se precisar
    await criarEstruturaEmpresaSeNaoExistir(data.empId);

    // 3) aplica dados do pré-cadastro
    const refEmpresaApp = doc(db, "empresas", data.empId, "dados", "app");
    const snap = await getDoc(refEmpresaApp);
    const cur = snap.exists() ? (snap.data() || {}) : {};
    const usuariosCur = Array.isArray(cur.usuarios) ? cur.usuarios : [];

    // ❌ NÃO GARANTE MASTER AQUI
    // MASTER é GLOBAL (índice central) e não deve ser criado/alterado por empresa

    // garante/atualiza ADMIN da empresa
    const idx = usuariosCur.findIndex(u =>
      String(u.tipo || "").toUpperCase() === "ADMIN" &&
      String(u.empresaId || "").toUpperCase() === data.empId
    );

    if (idx >= 0) {
      usuariosCur[idx].nome = data.adminNome.toUpperCase();
      usuariosCur[idx].user = data.adminUser;
      usuariosCur[idx].senha = data.adminSenha;
      usuariosCur[idx].empresaId = data.empId; // garante
      usuariosCur[idx].tipo = "ADMIN";         // garante
    } else {
      usuariosCur.push({
        id: Date.now() + 1,
        tipo: "ADMIN",
        nome: data.adminNome.toUpperCase(),
        user: data.adminUser,
        senha: data.adminSenha,
        empresaId: data.empId
      });
    }

    await setDoc(refEmpresaApp, {
      atualizadoEm: new Date().toISOString(),
      usuarios: usuariosCur,
      empresaPerfil: {
        nomeEmpresa: data.nomeEmpresa,
        docTipo: data.docTipo || "",
        docNumero: data.doc || "",
        adminNome: data.adminNome,
        criadoEm: cur?.empresaPerfil?.criadoEm || new Date().toISOString(),
      },
      billing: {
        diaPagamento: data.diaPagamento,
        ultimoPagamentoEm: new Date().toISOString(),
        bloqueado: false,
        bloqueadoEm: null,
        motivo: ""
      }
    }, { merge: true });

    // ✅ salva/atualiza no índice central SOMENTE do ADMIN que você acabou de criar
    // (e com a função salvarLoginIndex corrigida pra não sobrescrever senha de usuário existente)
    await salvarLoginIndex({
      user: data.adminUser,
      tipo: "ADMIN",
      empresaId: data.empId,
      senha: data.adminSenha
    });

    // 4) seleciona e atualiza UI
    await selecionarEmpresa(data.empId);
    await listarEmpresasUI();

    alert("✅ Empresa cadastrada com sucesso!");

    // 5) limpa campos
    ["pcEmpId","pcNomeEmpresa","pcDoc","pcAdminNome","pcAdminUser","pcAdminSenha"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

  } catch (e) {
    console.error("Erro no pré-cadastro:", e);
    alert("❌ Falha ao cadastrar empresa.\n\n" + (e?.message || e));
  } finally {
    const btn = document.getElementById("btnCadastrarEmpresa");
    if (btn) { btn.disabled = false; btn.textContent = "✅ Cadastrar Empresa"; }
  }
}

window.preCadastrarEmpresa = preCadastrarEmpresa;

function empresasConfigRef() {
  return doc(db, "config", "empresas");
}

async function garantirListaEmpresas() {
  const ref = empresasConfigRef();
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const inicial = [{ id: EMPRESA_PRINCIPAL_ID, nome: EMPRESA_PRINCIPAL_NOME }];
    await setDoc(ref, { atualizadoEm: new Date().toISOString(), empresas: inicial });
    return inicial;
  }

  const data = snap.data() || {};
  let lista = Array.isArray(data.empresas) ? data.empresas : [];

  lista = lista
    .map(e => {
      // compat: se antes era string
      if (typeof e === "string") {
        const id = e.trim().toUpperCase();
        return { id, nome: id };
      }

      const id = String(e?.id || "").trim().toUpperCase();
      let nome = String(e?.nome || id).trim();

      // ✅ FORÇA nome bonito da principal
      if (id === EMPRESA_PRINCIPAL_ID.toUpperCase()) {
        nome = EMPRESA_PRINCIPAL_NOME;
      }

      return { id, nome };
    })
    .filter(x => x.id);

  // ✅ garante principal na lista e com nome bonito
  if (!lista.some(x => x.id === EMPRESA_PRINCIPAL_ID.toUpperCase())) {
    lista.unshift({ id: EMPRESA_PRINCIPAL_ID.toUpperCase(), nome: EMPRESA_PRINCIPAL_NOME });
  }

  // salva de volta se precisou corrigir/migrar
  await setDoc(ref, { empresas: lista, atualizadoEm: new Date().toISOString() }, { merge: true });

  return lista;
}


async function salvarListaEmpresas(lista) {
  const ref = empresasConfigRef();

  const normalizada = (lista || [])
    .map(e => {
      if (typeof e === "string") {
        const id = e.trim().toUpperCase();
        return { id, nome: id };
      }
      const id = String(e?.id || "").trim().toUpperCase();
      let nome = String(e?.nome || id).trim();

      // ✅ FORÇA nome bonito da principal
      if (id === EMPRESA_PRINCIPAL_ID.toUpperCase()) {
        nome = EMPRESA_PRINCIPAL_NOME;
      }

      return { id, nome };
    })
    .filter(x => x.id);

  await setDoc(ref, {
    atualizadoEm: new Date().toISOString(),
    empresas: normalizada
  }, { merge: true });

  return normalizada;
}


async function listarEmpresasUI() {
  if (!exigirMaster()) return;

  const ul = document.getElementById("listaEmpresas");
  if (!ul) return;

  let lista = await garantirListaEmpresas(); // [{id,nome}]

  // remove principal da tela
  lista = lista.filter(e => e.id !== EMPRESA_PRINCIPAL);

  ul.innerHTML = "";

  if (!lista.length) {
    ul.innerHTML = "<li style='opacity:.85;'>Nenhuma empresa cadastrada ainda.</li>";
    return;
  }

  lista.forEach((obj) => {
    const empId = obj.id;
    const nome = obj.nome || empId;

    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.gap = "10px";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.padding = "10px";
    li.style.borderRadius = "10px";
    li.style.background = "#0f172a";
    li.style.marginTop = "8px";

    const btnSel = document.createElement("button");
    btnSel.type = "button";
    btnSel.textContent = `✅ Selecionar ${nome}`;
    btnSel.style.flex = "1";
    btnSel.onclick = () => selecionarEmpresa(empId);

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.textContent = "🗑";
    btnDel.style.width = "60px";

    btnDel.onclick = async () => {
      pararSnapshotAtual();

      try {
        if (!confirm(`Apagar a empresa ${nome} (${empId})?`)) return;

        li.remove();

        // remove da lista central
        const nova = (await garantirListaEmpresas()).filter(x => x.id !== empId);
        await salvarListaEmpresas(nova);

        // apaga doc da empresa
        await deleteDoc(doc(db, "empresas", empId, "dados", "app"));

        alert("✅ Empresa apagada!");
      } catch (e) {
        console.error(e);
        try { await listarEmpresasUI(); } catch {}

        if (String(e?.code || "").includes("resource-exhausted") || /quota/i.test(String(e?.message||""))) {
          alert("❌ Firestore estourou a quota agora. Reduza leituras/gravações.");
        } else {
          alert("❌ Não consegui apagar.\n\n" + (e?.message || e));
        }
      }
    };

    li.appendChild(btnSel);

const btnEdit = document.createElement("button");
btnEdit.type = "button";
btnEdit.textContent = "✏️";
btnEdit.style.width = "60px";
btnEdit.onclick = () => abrirEdicaoEmpresa(empId, nome);
li.appendChild(btnEdit);

li.appendChild(btnDel);
ul.appendChild(li);

  });
}



async function abrirEdicaoEmpresa(empId, nomeFallback) {
  try {
    if (!exigirMaster()) return;

    // 🔥 Lê do lugar onde você salva o pré-cadastro
    const ref = doc(db, "empresas", empId, "dados", "app");
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      alert("❌ Não achei os dados dessa empresa no Firestore.");
      return;
    }

    const data = snap.data() || {};

    // ✅ Campos do formulário
    const elEmpId       = document.getElementById("pcEmpId");
    const elNomeEmpresa = document.getElementById("pcNomeEmpresa");
    const elDoc         = document.getElementById("pcDoc");
    const elAdminNome   = document.getElementById("pcAdminNome");
    const elAdminUser   = document.getElementById("pcAdminUser");
    const elAdminSenha  = document.getElementById("pcAdminSenha");
    const elDiaPag      = document.getElementById("pcDiaPagamento");

    if (!elEmpId || !elNomeEmpresa || !elDoc || !elAdminNome || !elAdminUser || !elAdminSenha || !elDiaPag) {
      alert("❌ Não encontrei os campos do pré-cadastro. Confira os IDs no HTML.");
      return;
    }

    // ✅ Preenche com dados antigos
    elEmpId.value = data.empId || empId;
    elEmpId.readOnly = true;

    elNomeEmpresa.value = data.nomeEmpresa || nomeFallback || "";
    elDoc.value = data.doc || "";                 // CPF/CNPJ salvo
    elDiaPag.value = data.diaPagamento ?? 5;

    elAdminNome.value = data.adminNome || "";
    elAdminUser.value = data.adminUser || "";
    elAdminSenha.value = data.adminSenha || "";   // ✅ AQUI puxa a senha antiga

    // ✅ Troca o botão para salvar alterações
    const btn = document.getElementById("btnPreCadastrarEmpresa");
    if (!btn) {
      alert("❌ Botão btnPreCadastrarEmpresa não encontrado no HTML.");
      return;
    }

    btn.textContent = "💾 Salvar alterações";
    btn.onclick = () => salvarEdicaoEmpresa(empId);

    // abre a tela
    abrir("selecionarEmpresa");
  } catch (e) {
    console.error(e);
    alert("❌ Não consegui abrir edição.\n\n" + (e?.message || e));
  }
}




function cancelarEdicaoEmpresa() {
  // volta botão principal para cadastro
  const btn = document.getElementById("btnPreCadastrarEmpresa");
  btn.textContent = "➕ Cadastrar Empresa";
  btn.onclick = () => preCadastrarEmpresa();

  // libera campo ID
  const elEmpId = document.getElementById("pcEmpId");
  elEmpId.readOnly = false;

  // esconde o voltar/cancelar
  const btnCancel = document.getElementById("btnCancelarEdicaoEmpresa");
  if (btnCancel) btnCancel.style.display = "none";
}

async function salvarEdicaoEmpresa(empId) {
  try {
    if (!exigirMaster()) return;

    const nomeEmpresa = String(document.getElementById("pcNomeEmpresa").value || "").trim();
    const docu = onlyDigits(document.getElementById("pcDoc").value || "");
    const diaPagamento = Number(document.getElementById("pcDiaPagamento").value || 5);

    const adminNome  = String(document.getElementById("pcAdminNome").value || "").trim();
    const adminUser  = String(document.getElementById("pcAdminUser").value || "").trim().toLowerCase();
    const adminSenha = String(document.getElementById("pcAdminSenha").value || "").trim();

    if (!nomeEmpresa) return alert("❌ Nome da empresa é obrigatório.");
    if (!(diaPagamento >= 1 && diaPagamento <= 28)) return alert("❌ Dia de pagamento deve ser de 1 a 28.");

    const docTipo = detectarDocTipo(docu);
    if (docTipo === "INVALIDO") {
      return alert("❌ CPF/CNPJ inválido. Use 11 (CPF) ou 14 (CNPJ) dígitos, ou deixe em branco.");
    }

    // update parcial (merge) -> não apaga campos que já existem
    const update = {
      nomeEmpresa,
      doc: docu,
      docTipo,
      diaPagamento,
      atualizadoEm: Date.now(),
    };

    // só atualiza admin se estiver preenchido
    if (adminNome) update.adminNome = adminNome;
    if (adminUser) update.adminUser = adminUser;

    // só muda senha se digitou uma nova
    if (adminSenha) {
      if (adminSenha.length < 4) return alert("❌ Senha do ADMIN mínimo 4 caracteres.");
      update.adminSenha = adminSenha;
    }

    await setDoc(doc(db, "empresas", empId, "dados", "app"), update, { merge: true });

    alert("✅ Empresa atualizada!");

    // volta modo cadastro
    cancelarEdicaoEmpresa();

    // atualiza lista
    await listarEmpresasUI();
  } catch (e) {
    console.error(e);
    alert("❌ Não consegui salvar alterações.\n\n" + (e?.message || e));
  }
}



async function preencherSelectEmpresas(selId, lblId = null) {
  const sel = document.getElementById(selId);
  if (!sel) return;

  try {
    await ensureAuth();

    let lista = await garantirListaEmpresas(); // [{id,nome}]

    const norm = (lista || [])
      .map(e => {
        if (typeof e === "string") {
          const id = e.trim().toUpperCase();
          return { id, nome: id };
        }
        const id = String(e?.id || "").trim().toUpperCase();
        let nome = String(e?.nome || "").trim();

        if (id === EMPRESA_PRINCIPAL_ID && !nome) nome = EMPRESA_PRINCIPAL_NOME;


        return { id, nome: nome || id };
      })
      .filter(x => x.id);

    sel.innerHTML = `<option value="">Selecione...</option>`;

    norm.forEach(({ id, nome }) => {
      const opt = document.createElement("option");
      opt.value = id;         // ✅ o ID continua sendo o valor
      opt.textContent = nome; // ✅ nome bonito

      opt.dataset.nome = nome;
      sel.appendChild(opt);
    });

    // opcional: mostrar nome selecionado em um label
    if (lblId) {
      const lbl = document.getElementById(lblId);
      const atualizar = () => {
        const opt = sel.options[sel.selectedIndex];
        const nome = opt?.dataset?.nome || "";
        if (lbl) lbl.textContent = nome ? `🏢 ${nome}` : "";
      };
      sel.onchange = atualizar;
      atualizar();
    }

  } catch (e) {
    console.error("❌ erro preencherSelectEmpresas:", e);
    // fallback mínimo
    sel.innerHTML = `
  <option value="">Selecione...</option>
  <option value="${EMPRESA_PRINCIPAL_ID}">${EMPRESA_PRINCIPAL_NOME}</option>
`;
  }
}
window.preencherSelectEmpresas = preencherSelectEmpresas;


async function adicionarEmpresa() {
  if (!exigirMaster()) return;

  const empId = prompt("ID da empresa (ex: EMPRESA2):");
  if (empId === null) return;

  const id = String(empId).trim().toUpperCase();
  if (!id) return alert("❌ ID inválido.");
  if (id === EMPRESA_PRINCIPAL) return alert("⚠️ EMPRESA_PRINCIPAL_ID já é a principal.");

  const nomeBonito = prompt("Nome completo da empresa (vai aparecer na ocorrência):", id);
  if (nomeBonito === null) return;

  const nome = String(nomeBonito).trim();
  if (!nome) return alert("❌ Nome não pode ficar vazio.");

  let lista = await garantirListaEmpresas(); // [{id,nome}]

  const idx = lista.findIndex(e => String(e.id || "").toUpperCase() === id);
  if (idx === -1) {
    lista.push({ id, nome });
  } else {
    lista[idx].nome = nome; // atualiza nome se mudou
  }

  await salvarListaEmpresas(lista);

  // cria estrutura /empresas/ID/dados/app se precisar
  await criarEstruturaEmpresaSeNaoExistir(id);

  await listarEmpresasUI();
  alert("✅ Empresa adicionada com nome completo!");
}
window.adicionarEmpresa = adicionarEmpresa;


async function carregarEmpresas() {
  const lista = document.getElementById("listaEmpresas"); // <-- seu container da lista
  lista.innerHTML = "Carregando...";

  const snap = await getDocs(collection(db, "empresas"));

  if (snap.empty) {
    lista.innerHTML = "Nenhuma empresa cadastrada ainda.";
    return;
  }

  lista.innerHTML = "";
  snap.forEach((docu) => {
    const e = docu.data();
    const div = document.createElement("div");
    div.textContent = `${e.nomeEmpresa ?? "(sem nome)"} - ID: ${docu.id}`;
    lista.appendChild(div);
  });
}


async function carregarEmpresasPublicasFirestore() {
  const sel = document.getElementById("pubOcEmpresa");
  if (!sel) return;

  try {
    // ✅ GARANTE LOGIN ANÔNIMO ANTES DE LER O FIRESTORE
    await ensureAuth();

    let lista = await garantirListaEmpresas(); // [{id,nome}] ou ["EMP1"]

    // normaliza para [{id,nome}]
    const norm = (lista || [])
      .map(e => {
        if (typeof e === "string") {
          const id = e.trim().toUpperCase();
          return { id, nome: id };
        }
        const id = String(e?.id || "").trim().toUpperCase();
        let nome = String(e?.nome || "").trim();

        // ✅ garante o nome bonito da principal
        if (id === EMPRESA_PRINCIPAL_ID && !nome) nome = EMPRESA_PRINCIPAL_NOME;


        return { id, nome: nome || id };
      })
      .filter(x => x.id);

    sel.innerHTML = `<option value="">Selecione...</option>`;

    norm.forEach(({ id, nome }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = nome; // ✅ nome bonito
      opt.dataset.nome = nome;
      sel.appendChild(opt);
    });

    // (opcional) label embaixo mostrando nome selecionado
    const lbl = document.getElementById("pubOcEmpresaNome");
    function atualizarNomeSelecionado() {
      const opt = sel.options[sel.selectedIndex];
      const nome = opt?.dataset?.nome || "";
      if (lbl) lbl.textContent = nome ? `🏢 ${nome}` : "";
    }
    sel.onchange = atualizarNomeSelecionado;
    atualizarNomeSelecionado();

    const numEl = document.getElementById("pubOcNum");
    if (numEl) numEl.disabled = !sel.value;

  } catch (e) {
    console.error("❌ erro carregar empresas públicas:", e);

    // ✅ fallback melhor: já mostra EMPRESA_PRINCIPAL_ID em vez de EMPRESA_PRINCIPAL_ID
    sel.innerHTML = `
      <option value="">Selecione...</option>
      <option value="${EMPRESA_PRINCIPAL_ID}">${EMPRESA_PRINCIPAL_NOME}</option>
    `;
  }
}

function setRoleUI() {
  aplicarClassePermissaoBody();
}




function loginsRef() {
  return doc(db, "config", "logins");
}

async function salvarLoginIndex({ user, tipo, empresaId, senha, forceSenha = false }) {
  await ensureAuth();

  user = String(user || "").trim().toLowerCase();
  if (!user) throw new Error("❌ salvarLoginIndex: user inválido");

  const tipoNorm = String(tipo || "").trim().toUpperCase();
  const empNorm  = String(empresaId || "").trim().toUpperCase();
  const senhaNorm = String(senha || "").trim();

  const ref = doc(db, "config", "logins");
  const snap = await getDoc(ref);

  const data = snap.exists() ? (snap.data() || {}) : {};
  const usuarios = (data.usuarios && typeof data.usuarios === "object") ? data.usuarios : {};

  const atual = usuarios[user];

  if (atual) {
    // ✅ usuário já existe → NÃO altera senha (a não ser que forceSenha=true)
    const novo = {
      ...atual,
      tipo: tipoNorm || atual.tipo,
      empresaId: empNorm || atual.empresaId,
    };

    if (forceSenha) {
      if (!senhaNorm) throw new Error("❌ forceSenha=true mas senha vazia");
      novo.senha = senhaNorm;
    }

    usuarios[user] = novo;
  } else {
    // ✅ usuário novo → cria com senha
    if (!senhaNorm) throw new Error("❌ criar login novo sem senha");

    usuarios[user] = {
      empresaId: empNorm,
      senha: senhaNorm,
      tipo: tipoNorm || "COLAB",
    };
  }

  await setDoc(ref, {
    usuarios,
    atualizadoEm: new Date().toISOString(),
  }, { merge: true });

  return true;
}

async function buscarLoginIndex(user) {
  user = String(user || "").trim().toLowerCase();
  if (!user) return null;

  const snap = await getDoc(loginsRef());
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  const u = data.usuarios?.[user] || null;
  return u;
}

function ligarEventosOcorrenciaPublica() {
  const sel = document.getElementById("pubOcEmpresa");
  const numEl = document.getElementById("pubOcNum");
  const estabEl = document.getElementById("pubOcEstab");

  if (!sel || !numEl || !estabEl) return;

  sel.addEventListener("change", () => {
    numEl.value = "";
    estabEl.value = "";
    numEl.disabled = !sel.value;
  });

  let t = null;
  numEl.addEventListener("input", () => {
    clearTimeout(t);

    const emp = sel.value;
    const num = (numEl.value || "").trim().toUpperCase();
    numEl.value = num;
    estabEl.value = "";

    if (!emp || !num) return;

    t = setTimeout(async () => {
      const estab = await buscarEstabPorEmpresaENumero(emp, num);
      estabEl.value = estab ? estab : "❌ MÁQUINA NÃO ENCONTRADA";
    }, 300);
  });
}

// =======================
// 🔔 ALERTA DE OCORRÊNCIAS
// =======================
function atualizarAlertaOcorrencias() {
  try {
    // garante array
    const lista = Array.isArray(ocorrencias) ? ocorrencias : [];

    // considera "pendente" se NÃO estiver concluída
    // (aceita vários formatos: concluida, concluído, status, etc.)
    const pendentes = lista.filter(o => {
      if (!o) return false;

      // se tiver status textual
      const st = String(o.status || o.state || "").toUpperCase().trim();
      if (st) return !(st.includes("CONCL") || st.includes("FINAL") || st.includes("RESOLV"));

      // se tiver boolean de concluído
      if (typeof o.concluida === "boolean") return !o.concluida;
      if (typeof o.concluido === "boolean") return !o.concluido;

      // se tiver campo "finalizado"
      if (typeof o.finalizado === "boolean") return !o.finalizado;

      // default: se não tem nada, conta como pendente
      return true;
    });

    const n = pendentes.length;

    // ✅ PISCA 2 BOLINHAS NO BOTÃO "OCORRÊNCIAS"
const btnOc =
  document.getElementById("btnOcorrencias") ||
  document.querySelector("[data-btn='ocorrencias']") ||
  Array.from(document.querySelectorAll("button, a, div"))
    .find(el => (el.textContent || "").trim().toUpperCase().includes("OCORRÊNCIAS"));

if (btnOc) {
  if (n > 0) btnOc.classList.add("tem-alerta");
  else btnOc.classList.remove("tem-alerta");
}


    // 1) atualiza um badge se existir
    const badge =
      document.getElementById("badgeOcorrencias") ||
      document.querySelector("[data-badge='ocorrencias']") ||
      document.querySelector(".badge-ocorrencias");

    if (badge) {
      badge.textContent = n ? String(n) : "";
      badge.style.display = n ? "inline-flex" : "none";
    }

    // 2) muda o texto do botão/menu "Ocorrências" se achar
    // (ajusta os seletores conforme seu HTML)
    const btn =
      document.getElementById("btnOcorrencias") ||
      document.querySelector("[data-btn='ocorrencias']") ||
      Array.from(document.querySelectorAll("button, a, div"))
        .find(el => (el.textContent || "").trim().toUpperCase() === "OCORRÊNCIAS");

    if (btn) {
      // não destrói o texto original se você já usa HTML interno
      // aqui só adiciona um sufixo simples
      const base = "Ocorrências";
      btn.textContent = n ? `${base} (${n})` : base;
    }

    // 3) opcional: título da aba
      try {
  const empId = String(empresaAtualId || EMPRESA_PRINCIPAL_ID).toUpperCase();
  getNomeBonitoEmpresa(empId).then(nome => {
    document.title = nome || EMPRESA_PRINCIPAL_NOME;
  });
} catch {}

  } catch (e) {
    console.warn("atualizarAlertaOcorrencias falhou:", e);
  }
}

// deixa global (garante que chamadas diretas funcionem)
window.atualizarAlertaOcorrencias = atualizarAlertaOcorrencias;



function ligarAutoEstabPorEmpresaENumero({ selId, numId, estabId }) {
  const sel = document.getElementById(selId);
  const numEl = document.getElementById(numId);
  const estabEl = document.getElementById(estabId);

  if (!sel || !numEl || !estabEl) {
    console.warn("❌ Não achei os elementos:", { selId, numId, estabId });
    return;
  }

  // ao trocar empresa, limpa campos
  sel.addEventListener("change", () => {
    numEl.value = "";
    estabEl.value = "";
    numEl.disabled = !sel.value;
  });

  let t = null;
  numEl.addEventListener("input", () => {
    clearTimeout(t);

    const emp = sel.value;
    const num = (numEl.value || "").trim().toUpperCase();
    numEl.value = num;
    estabEl.value = "";

    if (!emp || !num) return;

    t = setTimeout(async () => {
      const estab = await buscarEstabPorEmpresaENumero(emp, num);
      estabEl.value = estab ? estab : "❌ MÁQUINA NÃO ENCONTRADA";
    }, 300);
  });

  // estado inicial
  numEl.disabled = !sel.value;
}

// ==========================
// ✅ FECHAMENTO: modo (DIARIO | MENSAL)
// ==========================
window.__fcModo = window.__fcModo || "DIARIO";

window.fcSetModo = function (modo) {
  window.__fcModo = String(modo || "DIARIO").toUpperCase();
  renderFechamentoCaixa();
};


window.ligarUIFechamentoCaixa = function () {
  const ini = document.getElementById("fcIni");
  const fim = document.getElementById("fcFim");
  const bDia = document.getElementById("btnFCDiario");
  const bMes = document.getElementById("btnFCMensal");
  const bGerar = document.getElementById("btnFCGerar");


  if (!ini || !fim || !bDia || !bMes) return;

  ini.addEventListener("change", renderFechamentoCaixa);
  fim.addEventListener("change", renderFechamentoCaixa);

  bDia.addEventListener("click", () => window.fcSetModo("DIARIO"));
  bMes.addEventListener("click", () => window.fcSetModo("MENSAL"));

  if (bGerar) bGerar.addEventListener("click", renderFechamentoCaixa);
};

// liga 1x só
window.addEventListener("load", () => {
  try { window.ligarUIFechamentoCaixa(); } catch (e) { console.log(e); }
  
});




async function setNomeEmpresa(empId, nomeBonito) {
  empId = String(empId || "").trim().toUpperCase();
  nomeBonito = String(nomeBonito || "").trim();
  if (!empId || !nomeBonito) return;

  await ensureAuth();

  // 1) salva no DOC da empresa
  const ref = doc(db, "empresas", empId, "dados", "app");
  await setDoc(ref, { empresaPerfil: { nomeEmpresa: nomeBonito } }, { merge: true });

  // 2) salva também na lista central (config/empresas)
  let lista = await garantirListaEmpresas(); // [{id,nome}]
  const idx = lista.findIndex(e => String(e.id || "").toUpperCase() === empId);

  if (idx === -1) lista.push({ id: empId, nome: nomeBonito });
  else lista[idx].nome = nomeBonito; // ✅ AQUI

  await salvarListaEmpresas(lista);
  return true;
}
window.setNomeEmpresa = setNomeEmpresa;


// =====================
// ✅ EXPOR FUNÇÕES PRO HTML (porque script.js é type="module")
// =====================
Object.assign(window, {
  arAutoPorNumero,
  salvarRelogioAtualAdmin,
  exportarDados,
  importarDadosArquivo,
  salvarLoginIndex,
  buscarLoginIndex,
  repararIndiceLoginsDaEmpresa,
  iniciarSincronizacaoFirebase,
  salvarNoFirebase,
  definirEmpresa,
  atualizarStatus,
  crAutoPorNumero,
  salvarCreditoRemoto,
  avisarTodosColaboradores,
  abrirWhatsTexto,
  abrirWhatsBusiness,
  abrirWhatsNormal,
  trocarSenhaAdmin,
  trocarCredenciaisAdmin,
  adicionarEmpresa,
  listarEmpresasUI,
  selecionarEmpresa,
  fazerLogin,
  entrarLogin,
  sair,
  abrir,
  voltar,
  pubOcAutoPorNumero,
  salvarOcorrenciaPublica,
  autoPorNumero,
  autoPorEstab,
  atualizarPreviewAcerto,
  salvarAcerto,
  pegarLocalizacaoCadastro,
  salvarMaquina,
  listarMaquinas,
  abrirDetalheMaquina,
  carregarMaquinaPorNumero,
  atualizarLocalizacaoDetalhe,
  salvarAlteracoesMaquina,
  apagarMaquina,
  ocAutoPorNumero,
  salvarOcorrencia,
  listarOcorrencias,
  concluirOcorrencia,
  ligarTelefone,
  abrirWhats,
  abrirHistoricoVendas,
  renderHistoricoVendas,
  adicionarColaborador,
  listarColaboradores,
  pegarLocalizacao,
  abrirNoMaps,
  listarLocaisSalvos,
  mostrarPainelLocal,
  autoLocalPorNumero,
  autoLocalPorEstab,
  abrirLocalizacaoMaquina,
  toggleSenha,
  mostrarApp,
  mostrarTelaLogin,
  preCadastrarEmpresa,
  setNomeEmpresa,
  fcSetDiarioHoje,
  fcSetMensalAtual,
  renderFechamentoCaixa,
});


window.definirEmpresa = definirEmpresa;

// ✅ DEBUG: expõe sessão no console (porque é module)
window.getSessao = () => sessaoUsuario;
window.getUsuarios = () => usuarios;
window.getMaquinas = () => maquinas;



// ✅ TESTE (coloque aqui embaixo, no final do arquivo)
console.log(typeof window.atualizarStatus);
console.log(typeof window.crAutoPorNumero);
console.log(typeof window.avisarTodosColaboradores);


window.toggleSenha = toggleSenha;
window.mostrarApp = mostrarApp;

window.debugColabs = () => {
  console.log("firebasePronto:", firebasePronto);
  console.log("sessaoUsuario:", sessaoUsuario);
  console.log("usuarios:", usuarios);
  console.log("qtde usuarios:", (usuarios || []).length);
  console.log("qtde colabs:", (usuarios || []).filter(u => String(u.tipo).toUpperCase() === "COLAB").length);
};

console.log("OK carregou script");
console.log("fazerLogin:", typeof window.fazerLogin);
console.log("abrirWhatsTexto:", typeof window.abrirWhatsTexto);

// ✅ ALIAS: evita crash se você trocar o nome sem querer
// se alguém chamar carregarSessao(), não quebra o app
if (typeof window.carregarSessao !== "function") {
  window.carregarSessao = function () {
    try {
      // Se você tiver uma lógica real de "carregar sessão", chame aqui.
      // Por enquanto: apenas loga e retorna false/true.
      const ok = !!window.__sessao;
      console.log("carregarSessao (alias):", ok ? "tem sessão" : "sem sessão");
      return ok;
    } catch (e) {
      console.warn("carregarSessao (alias) falhou:", e);
      return false;
    }
  };
}

let __visReconnAt = 0;

function carregarSessao() {
  sessaoUsuario = null;
}

window.carregarSessao = carregarSessao; // ✅ garante global


function validarSessaoPersistida() {
  if (!sessaoUsuario) return false;

  const user = String(sessaoUsuario.user || "").toLowerCase();
  const tipo = String(sessaoUsuario.tipo || "").toUpperCase();
  const empAtual = String(empresaAtualId || "").toUpperCase();
  if (!user || !tipo) return false;

  const criadoEm = Number(sessaoUsuario.criadoEm || 0);
  if (criadoEm && (Date.now() - criadoEm) > (12 * 60 * 60 * 1000)) {
    limparSessao();
    return false;
  }

  // ✅ MASTER não depende do array de usuários da empresa
  if (tipo === "MASTER") return true;

  // ✅ ADMIN/COLAB dependem da empresa atual
  const u = (usuarios || []).find(x =>
    String(x.user || "").toLowerCase() === user &&
    String(x.tipo || "").toUpperCase() === tipo
  );
  if (!u) return false;

  const empUser = String(u.empresaId || "").toUpperCase();
  if (!empUser || empUser !== empAtual) return false;

  return true;
}
window.validarSessaoPersistida = validarSessaoPersistida;


// ===============================
// ✅ OCULTAR "CADASTRO/CADASTRAR MÁQUINA" PARA COLAB (GLOBAL + ANTI-REAPARECER)
// ===============================

function ocultarCadastroMaquinaParaColab() {
  if (typeof isAdmin !== "function" || !isAdmin()) return;


  // 1) esconde por seletores conhecidos (menu e telas)
  const seletores = [
    "#btnCadastrarMaquina",
    "#colaboradores #btnCadastrarMaquina",
    "#colaboradores .btnCadastrarMaquina",
    "[data-btn='cadastrarMaquina']",
    "[data-action='cadastrarMaquina']",
    "[onclick*='cadastroMaquina']",
    "[onclick*='salvarMaquina']"
  ];

  document.querySelectorAll(seletores.join(",")).forEach((el) => {
    el.style.setProperty("display", "none", "important");
  });

  // 2) fallback por TEXTO (pega variações)
  const alvos = ["CADASTRO DE MAQUINA", "CADASTRAR MAQUINA"];

  document
    .querySelectorAll("button, a, [role='button'], .btn, li, div")
    .forEach((el) => {
      const t = _normTxt(el.textContent || "");
      if (alvos.some((x) => t.includes(x))) {
        el.style.setProperty("display", "none", "important");
      }
    });
}

// ✅ ativa proteção: roda agora + observa mudanças no DOM
function ativarProtecaoCadastroMaquinaColab() {
  try { ocultarCadastroMaquinaParaColab(); } catch {}

  // evita criar vários observers
  if (window.__obsCadMaq) return;

  window.__obsCadMaq = new MutationObserver(() => {
    // só aplica se for COLAB (economiza processamento)
    try {
      if (!isAdmin()) ocultarCadastroMaquinaParaColab();
    } catch {}
  });

  window.__obsCadMaq.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// ✅ opcional: se quiser desligar (debug)
function desativarProtecaoCadastroMaquinaColab() {
  try {
    if (window.__obsCadMaq) {
      window.__obsCadMaq.disconnect();
      window.__obsCadMaq = null;
    }
    // (opcional) reexibe o botão caso tenha escondido via style
    const el = document.getElementById("btnCadastrarMaquina");
    if (el) el.style.removeProperty("display");
  } catch (e) {
    console.warn("desativarProtecaoCadastroMaquinaColab falhou:", e);
  }
}

// se você precisar chamar pelo HTML:
window.desativarProtecaoCadastroMaquinaColab = desativarProtecaoCadastroMaquinaColab;


// expõe se quiser chamar manualmente
Object.assign(window, {
  ocultarCadastroMaquinaParaColab,
  ativarProtecaoCadastroMaquinaColab,
  desativarProtecaoCadastroMaquinaColab,
});


function bindMenuButtons() {
  const map = [
    ["btnFechamentoCaixa", "abrirFechamentoCaixa"],
    ["btnTrocarSenhaAdmin", "trocarSenhaAdmin"],
    ["btnTrocarCredenciaisAdmin", "trocarCredenciaisAdmin"],
    ["btnColaboradores", "abrirColaboradores"]
  ];

  map.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.onclick = (ev) => {
      ev.preventDefault();

      const f = window[fn];
      if (typeof f !== "function") {
        console.error(`❌ Função ${fn} não existe no window.`);
        alert(`❌ Botão "${id}" não está ligado. Função "${fn}" não encontrada.`);
        return;
      }

      try {
        f();
      } catch (e) {
        console.error(`❌ Erro ao executar ${fn}:`, e);
        alert(`❌ Erro ao abrir: ${fn}\n\n` + (e?.message || e));
      }
    };
  });
}

// garante depois do DOM pronto
window.addEventListener("load", () => {
  bindMenuButtons();
});


// ✅ GARANTE: função que faltava (Colaboradores)
function abrirColaboradores() {
  if (!exigirAdmin()) return;
  abrir("colaboradores");
  try { listarColaboradores(); } catch(e) { console.log(e); }
}
window.abrirColaboradores = abrirColaboradores;


// ✅ SUPER BIND (delegação) - nunca mais “botão não funciona”
document.addEventListener("click", (ev) => {
  const el = ev.target.closest(
    "#btnFechamentoCaixa,#btnTrocarSenhaAdmin,#btnTrocarCredenciaisAdmin,#btnColaboradores"
  );
  if (!el) return;

  ev.preventDefault();
  ev.stopPropagation();

  const map = {
    btnFechamentoCaixa: "abrirFechamentoCaixa",
    btnTrocarSenhaAdmin: "trocarSenhaAdmin",
    btnTrocarCredenciaisAdmin: "trocarCredenciaisAdmin",
    btnColaboradores: "abrirColaboradores",
  };

  const fnName = map[el.id];
  const fn = window[fnName];

  console.log("✅ Clique:", el.id, "->", fnName, "tipo:", typeof fn);

  if (typeof fn !== "function") {
    alert(`❌ Função ${fnName} não está disponível no window.`);
    return;
  }

  try {
    fn();
  } catch (e) {
    console.error(`❌ Erro em ${fnName}:`, e);
    alert(`❌ Erro ao executar ${fnName}\n\n` + (e?.message || e));
  }
});


window.toggleSenha = toggleSenha;


async function migrarEmpresaId(oldId, newId) {
  oldId = String(oldId || "").trim().toUpperCase();
  newId = String(newId || "").trim().toUpperCase();
  if (!oldId || !newId) return alert("IDs inválidos.");
  if (oldId === newId) return alert("Old e New são iguais.");

  await ensureAuth();

  const oldRef = doc(db, "empresas", oldId, "dados", "app");
  const newRef = doc(db, "empresas", newId, "dados", "app");

  const oldSnap = await getDoc(oldRef);
  if (!oldSnap.exists()) return alert("Empresa antiga não existe: " + oldId);

  const data = oldSnap.data() || {};

  // grava no novo ID
  await setDoc(newRef, {
    ...data,
    atualizadoEm: new Date().toISOString(),
    empresaPerfil: {
      ...(data.empresaPerfil || {}),
      nomeEmpresa: "EMPRESA_PRINCIPAL_ID"
    }
  });

  // atualiza lista central (config/empresas)
  let lista = await garantirListaEmpresas();
  // remove old
  lista = lista.filter(e => String(e.id || "").toUpperCase() !== oldId);
  // adiciona new
  if (!lista.some(e => String(e.id || "").toUpperCase() === newId)) {
    lista.push({ id: newId, nome: "EMPRESA_PRINCIPAL_ID" });
  } else {
    lista = lista.map(e => String(e.id||"").toUpperCase() === newId ? { id:newId, nome:"EMPRESA_PRINCIPAL_ID" } : e);
  }
  await salvarListaEmpresas(lista);

  // atualiza logins no índice central (config/logins)
  // (troca empresaId de quem era oldId)
  const logSnap = await getDoc(loginsRef());
  if (logSnap.exists()) {
    const logData = logSnap.data() || {};
    const users = logData.usuarios || {};
    const updates = {};

    for (const [user, info] of Object.entries(users)) {
      if (String(info?.empresaId || "").toUpperCase() === oldId) {
        updates[user] = { ...info, empresaId: newId };
      }
    }

    if (Object.keys(updates).length) {
      await setDoc(loginsRef(), {
        atualizadoEm: new Date().toISOString(),
        usuarios: updates
      }, { merge: true });
    }
  }

  // opcional: apagar antiga
  // await deleteDoc(oldRef);

  localStorage.setItem("empresaAtualId", newId);

  alert(`✅ Migração concluída!\n${oldId} → ${newId}\n\nAgora recarregue a página.`);
}
window.migrarEmpresaId = migrarEmpresaId;


function debugColabs() {
  try {
    const emp = String(empresaAtualId || "").toUpperCase();
    const lista = listarColaboradoresComWhats(); // já normaliza e filtra
    console.log("=== DEBUG COLABS ===");
    console.log("empresaAtualId:", emp);
    console.log("total usuarios:", (usuarios || []).length);
    console.table(
      (usuarios || [])
        .filter(u => String(u.tipo || "").toUpperCase() === "COLAB")
        .map(u => ({
          nome: u.nome,
          user: u.user,
          empresaId: u.empresaId,
          whats_raw: u.whats,
          whats_norm: normalizarWhats(u.whats),
          ok_whats: !!normalizarWhats(u.whats)
        }))
    );

    console.log("colabs com whats válido (da empresa atual):", lista.length);
    console.table(lista.map(c => ({
      nome: c.nome,
      user: c.user,
      empresaId: c.empresaId,
      whats: c.whats
    })));

    alert(`✅ Debug Colabs\nEmpresa: ${emp}\nColabs com Whats válido: ${lista.length}`);
  } catch (e) {
    console.error("debugColabs erro:", e);
    alert("❌ debugColabs falhou: " + (e?.message || e));
  }
}

window.debugColabs = debugColabs;


console.log("OK carregou script");
console.log("fazerLogin:", typeof window.fazerLogin);
console.log("abrirWhatsTexto:", typeof window.abrirWhatsTexto);

// ✅ ALIAS: evita crash se você trocar o nome sem querer
if (typeof window.carregarSessao !== "function") {
  window.carregarSessao = function () {
    try {
      const ok = !!window.__sessao;
      console.log("carregarSessao (alias):", ok ? "tem sessão" : "sem sessão");
      return ok;
    } catch (e) {
      console.warn("carregarSessao (alias) falhou:", e);
      return false;
    }
  };
}


window.addEventListener("load", () => {
  try {
    // garante empresa atual logo no começo
    if (!empresaAtualId) {
      const emp = localStorage.getItem("empresaAtualId") || EMPRESA_PRINCIPAL_ID;
      setEmpresaAtual(emp);
    }

    atualizarNomeEmpresaNaTela().catch(console.error);
  } catch (e) {
    console.error("Falha ao setar nome no topo:", e);
  }
});

console.count("📦 script.js avaliou");


async function clicarSalvar() {
  const ok = await salvarNoFirebase(true);
  if (ok) alert("✅ Alterações salvas!");
}


document.addEventListener("input", (e) => {
  if (e.target?.id === "detCpf" || e.target?.id === "detRg") {
    const cpf = (document.getElementById("detCpf")?.value || "").trim();
    const rg  = (document.getElementById("detRg")?.value  || "").trim();
    const erro = document.getElementById("erroCpfRgDetalhe");
    if (erro) erro.style.display = (!cpf && !rg) ? "block" : "none";
  }
});



window.fcEnsureModalPct = function fcEnsureModalPct() {
  if (document.getElementById("modalEditarPctFC")) return;

  const wrap = document.createElement("div");
  wrap.id = "modalEditarPctFC";
  wrap.style.cssText = `
    position:fixed !important;
    inset:0 !important;
    display:none;
    align-items:center;
    justify-content:center;
    background:rgba(0,0,0,.65);
    z-index:999999;
    padding:16px;
  `;

  wrap.innerHTML = `
    <div id="modalEditarPctFC_card" style="
      width:min(520px, 96vw);
      background:#0b1220;
      color:#fff;
      border-radius:16px;
      padding:16px;
      box-shadow:0 12px 40px rgba(0,0,0,.6);
      border:1px solid rgba(255,255,255,.08);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
    ">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="font-weight:800; font-size:18px;">✏️ Editar % do cliente</div>
        <button id="btnFecharModalPctFC" type="button" style="
          width:36px; height:36px;
          border-radius:10px;
          border:1px solid rgba(255,255,255,.15);
          background:rgba(255,255,255,.08);
          color:#fff;
          cursor:pointer;
        ">✖</button>
      </div>

      <div style="margin-top:10px; opacity:.9; font-size:14px; line-height:1.3;">
        <div id="pctFcEstab"></div>
        <div id="pctFcPeriodo" style="margin-top:4px;"></div>
        <div style="margin-top:8px;">Total empresa: <b id="pctFcTotal"></b></div>
      </div>

      <div style="margin-top:14px;">
        <label style="display:block; font-size:13px; opacity:.85; margin-bottom:6px;">% novo</label>
        <input id="pctFcNovo" type="number" min="0" max="100" step="0.01" style="
          width:100%;
          padding:12px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,.15);
          background:#0f1a2f;
          color:#fff;
          outline:none;
        "/>
      </div>

      <div style="margin-top:12px; font-size:13px; opacity:.9;">
        <div>Empresa: <b id="pctFcEmpresa"></b></div>
        <div>A repassar: <b id="pctFcRepassar"></b></div>
        <div>A recolher: <b id="pctFcRecolher"></b></div>
      </div>

      <div style="margin-top:16px; display:flex; gap:10px; justify-content:flex-end;">
        <button id="btnCancelarModalPctFC" type="button" style="
          padding:10px 14px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,.15);
          background:rgba(255,255,255,.06);
          color:#fff;
          cursor:pointer;
        ">Cancelar</button>

        <button id="btnSalvarModalPctFC" type="button" style="
          padding:10px 14px;
          border-radius:12px;
          border:0;
          background:#22c55e;
          color:#06220f;
          font-weight:800;
          cursor:pointer;
        ">Salvar</button>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  // fechar clicando fora do card
  wrap.addEventListener("click", (e) => {
    const card = document.getElementById("modalEditarPctFC_card");
    if (card && !card.contains(e.target)) {
      wrap.style.display = "none";
    }
  });

  // binds
  document.getElementById("btnFecharModalPctFC")?.addEventListener("click", () => wrap.style.display = "none");
  document.getElementById("btnCancelarModalPctFC")?.addEventListener("click", () => wrap.style.display = "none");
  document.getElementById("btnSalvarModalPctFC")?.addEventListener("click", () => {
    // aqui você chama sua função real de salvar
    if (typeof fcSalvarPctModal === "function") fcSalvarPctModal();
    else alert("Salvou (teste). Agora liga no fcSalvarPctModal()");
  });
  document.getElementById("pctFcNovo")?.addEventListener("input", () => {
    if (typeof fcAtualizarPreviewPct === "function") fcAtualizarPreviewPct();
  });
};


window.fcAbrirModalPct = function fcAbrirModalPct(estab, total) {
  window.fcEnsureModalPct();

  document.getElementById("pctFcEstab").textContent = `Estab: ${estab}`;
  document.getElementById("pctFcPeriodo").textContent = `Período atual`; // depois você põe o período real
  document.getElementById("pctFcTotal").textContent =
    Number(total || 0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });

  // default
  document.getElementById("pctFcNovo").value = "";

  const m = document.getElementById("modalEditarPctFC");
  m.style.display = "flex";

  console.log("✅ Modal aberto!");
};


// ✅ FIX DEFINITIVO - BOTÃO "Editar %" (Fechamento de Caixa)
(function () {
  function fcAbrirModalPctFIX(estab, total) {
    // garante modal criado
    if (typeof fcEnsureModalPct === "function") fcEnsureModalPct();

    // permissão
    if (typeof fcIsAdmin === "function" && !fcIsAdmin()) {
      alert("Somente ADMIN pode editar.");
      return;
    }

    // contexto do modal (usado no salvar/preview)
    window.__pctCtx = {
      estab: String(estab || "").trim(),
      total: Number(total || 0),
    };

    // preenche infos do modal
    const elEstab = document.getElementById("pctFcEstab");
    const elPeriodo = document.getElementById("pctFcPeriodo");
    const elTotal = document.getElementById("pctFcTotal");
    const inp = document.getElementById("pctFcNovo");

    if (elEstab) elEstab.textContent = `Estab: ${window.__pctCtx.estab}`;
    if (elPeriodo) {
      const ini = document.getElementById("fcIni")?.value || "";
      const fim = document.getElementById("fcFim")?.value || "";
      const modo = String(window.__fcModo || window._fcModo || "DIARIO").toUpperCase();
      elPeriodo.textContent = `Modo: ${modo} | Período: ${ini.split("-").reverse().join("/")} até ${fim.split("-").reverse().join("/")}`;
    }
    if (elTotal) {
      elTotal.textContent = (typeof fcMoney === "function")
        ? fcMoney(window.__pctCtx.total)
        : window.__pctCtx.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    // carrega % atual (se já tiver override pro período)
    const key = (typeof fcPeriodoKey === "function") ? fcPeriodoKey() : "";
    let atual = null;

    try {
      const all = (typeof fcGetPctOverrides === "function") ? fcGetPctOverrides() : {};
      const ovr = all[key] || {};
      if (ovr && ovr[window.__pctCtx.estab] != null) atual = Number(ovr[window.__pctCtx.estab]);
    } catch {}

    if (inp) inp.value = (atual != null && !Number.isNaN(atual)) ? String(atual) : "";

    // ✅ ABRE o modal (era isso que faltava)
    const modal = document.getElementById("modalEditarPctFC");
    if (modal) modal.style.display = "flex";

    // atualiza preview
    if (typeof fcAtualizarPreviewPct === "function") fcAtualizarPreviewPct();

    // foco no input
    setTimeout(() => inp?.focus?.(), 0);

    console.log("✅ Modal Editar % aberto (FIX)", window.__pctCtx);
  }

  // sobrescreve TUDO (pega tanto chamada direta quanto window.)
  window.fcAbrirModalPct = fcAbrirModalPctFIX;
  try { fcAbrirModalPct = fcAbrirModalPctFIX; } catch {}
})();


// ✅ FIX: salvar/preview do modal Editar % funcionando com script type="module"
(function () {
  function getPctCtx() {
    // tenta usar o __pctCtx do módulo (se existir) e cai pro window
    try {
      if (typeof __pctCtx !== "undefined" && __pctCtx) return __pctCtx;
    } catch {}
    return window.__pctCtx || null;
  }

  function setPctCtx(v) {
    // grava nos dois lugares (módulo e window) pra não dar mais conflito
    try { __pctCtx = v; } catch {}
    window.__pctCtx = v;
  }

  // 🔁 garante que o AbrirModal também grava no __pctCtx certo
  const oldAbrir = window.fcAbrirModalPct;
  window.fcAbrirModalPct = function (estab, total) {
    setPctCtx({ estab: String(estab || "").trim(), total: Number(total || 0) });
    if (typeof oldAbrir === "function") return oldAbrir(estab, total);
  };

  // ✅ PREVIEW: agora funciona e preenche Empresa / A repassar / A recolher
  window.fcAtualizarPreviewPct = function () {
    const ctx = getPctCtx();
    if (!ctx) return;

    const pct = Number(document.getElementById("pctFcNovo")?.value || 0);
    const total = Number(ctx.total || 0);

    const repassar = Math.max(0, total * (pct / 100));
    const empresa  = Math.max(0, total - repassar);
    const recolher = empresa;

    const money = (v) =>
      Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const eEmp = document.getElementById("pctFcEmpresa");
    const eRep = document.getElementById("pctFcRepassar");
    const eRec = document.getElementById("pctFcRecolher");

    if (eEmp) eEmp.textContent = money(empresa);
    if (eRep) eRep.textContent = money(repassar);
    if (eRec) eRec.textContent = money(recolher);
  };

  // ✅ SALVAR: agora grava override e re-renderiza fechamento
  window.fcSalvarPctModal = function () {
    const ctx = getPctCtx();
    if (!ctx) return alert("❌ Contexto do modal vazio (ctx).");

    const pct = Number(document.getElementById("pctFcNovo")?.value || 0);
    if (pct < 0 || pct > 100) return alert("Percentual inválido (0 a 100).");

    const all = (typeof window.fcGetPctOverrides === "function") ? window.fcGetPctOverrides() : {};
    const key = (typeof window.fcPeriodoKey === "function") ? window.fcPeriodoKey() : "";

    if (!key) return alert("❌ Não consegui montar a chave do período (fcPeriodoKey).");

    all[key] = all[key] || {};
    all[key][ctx.estab] = pct;

    if (typeof window.fcSetPctOverrides === "function") window.fcSetPctOverrides(all);

    // fecha modal
    const m = document.getElementById("modalEditarPctFC");
    if (m) m.style.display = "none";

    // limpa ctx
    setPctCtx(null);

    // re-render
    try { window.renderFechamentoCaixa(); } catch {}

    alert("✅ % do cliente atualizado nesse fechamento!");
  };

})();


// ===============================
// ✅ FIX FINAL: Salvar % do Fechamento (CAPTURE + localStorage)
// ===============================
(function () {
  const FC_PCT_KEY = "fcPctOverride";

  function periodoKey() {
    const ini = document.getElementById("fcIni")?.value || "";
    const fim = document.getElementById("fcFim")?.value || "";
    const modo = String(window.__fcModo || window._fcModo || "DIARIO").toUpperCase();
    return `${modo}|${ini}|${fim}`;
  }

  function getOverrides() {
    try { return JSON.parse(localStorage.getItem(FC_PCT_KEY) || "{}"); }
    catch { return {}; }
  }

  function setOverrides(obj) {
    localStorage.setItem(FC_PCT_KEY, JSON.stringify(obj || {}));
  }

  // ✅ garante que ao abrir modal sempre existe ctx em window
  const oldOpen = window.fcAbrirModalPct;
  window.fcAbrirModalPct = function (estab, total) {
    window.__pctCtx = { estab: String(estab || "").trim(), total: Number(total || 0) };
    const r = (typeof oldOpen === "function") ? oldOpen(estab, total) : undefined;

    const modal = document.getElementById("modalEditarPctFC");
    if (modal) modal.style.display = "flex";

    console.log("✅ ctx setado:", window.__pctCtx);
    return r;
  };

  // ✅ salvar global (pra qualquer chamada)
  window.fcSalvarPctModal = function () {
    const ctx = window.__pctCtx;
    if (!ctx?.estab) return alert("❌ Sem contexto do estabelecimento.");

    const pct = Number(document.getElementById("pctFcNovo")?.value || 0);
    if (!(pct >= 0 && pct <= 100)) return alert("❌ Percentual inválido (0 a 100).");

    const key = periodoKey();
    const all = getOverrides();

    all[key] = all[key] || {};
    all[key][ctx.estab] = pct;

    setOverrides(all);

    console.log("✅ SALVO localStorage:", FC_PCT_KEY, all);

    const modal = document.getElementById("modalEditarPctFC");
    if (modal) modal.style.display = "none";

    window.__pctCtx = null;

    try { window.renderFechamentoCaixa(); } catch {}
    alert("✅ % do cliente atualizado nesse fechamento!");
  };

  // ✅ CAPTURE: pega o clique antes de qualquer stopPropagation
  document.addEventListener("click", (ev) => {
    const btnSalvar   = ev.target.closest("#btnSalvarModalPctFC");
    const btnCancelar = ev.target.closest("#btnCancelarModalPctFC");
    const btnFechar   = ev.target.closest("#btnFecharModalPctFC");

    if (!btnSalvar && !btnCancelar && !btnFechar) return;

    ev.preventDefault();
    ev.stopPropagation();

    if (btnSalvar) {
      console.log("🟩 CLICK SALVAR capturado");
      return window.fcSalvarPctModal();
    }

    if (btnCancelar || btnFechar) {
      console.log("🟦 CLICK FECHAR/CANCELAR capturado");
      const modal = document.getElementById("modalEditarPctFC");
      if (modal) modal.style.display = "none";
      return;
    }
  }, true);
})();

window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btnCadastrarEmpresa");
  if (!btn) return;

  if (btn.dataset.bound === "1") return; // evita duplicar
  btn.dataset.bound = "1";

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    preCadastrarEmpresa();
  });
});

// =========================================
// 🔒 BOTÕES BLOQUEAR/DESBLOQUEAR NA LISTA
// (Embaixo de cada "Selecionar <Empresa>")
// =========================================

function __isMaster() {
  return String((window.sessaoUsuario && window.sessaoUsuario.tipo) || "").toUpperCase() === "MASTER";
}

function __normalizaEmpIdPorTextoSelecionar(txt) {
  // pega "Selecionar Mini Micro" -> "MINI-MICRO"
  const t = String(txt || "").trim();
  const semPrefixo = t.replace(/^selecionar\s+/i, "").trim();
  if (!semPrefixo) return "";

  // usa sua normaliza se existir, senão faz fallback
  if (typeof normalizaEmpresaId === "function") return normalizaEmpresaId(semPrefixo);
  if (typeof normalizaEmpresaId === "function") return normalizaEmpresaId(semPrefixo);

  return String(semPrefixo).trim().toUpperCase().replace(/\s+/g, "-");
}

async function __lerStatusBloqueioEmpresa(empId) {
  try {
    await ensureAuth();
    const id = String(empId || "").trim().toUpperCase();
    if (!id) return { manualBlocked: false, reason: "" };

    const ref = doc(db, "empresas", id, "dados", "app");
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const perfil = (data.empresaPerfil && typeof data.empresaPerfil === "object") ? data.empresaPerfil : {};

    return {
      manualBlocked: perfil.manualBlocked === true,
      reason: String(perfil.manualBlockedReason || "").trim(),
    };
  } catch (e) {
    console.warn("__lerStatusBloqueioEmpresa erro:", e);
    return { manualBlocked: false, reason: "" };
  }
}

function __criarBtnAzul(txt) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = txt;
  // estilo parecido com seus botões
  b.style.cssText =
    "width:100%;padding:14px;border:none;border-radius:16px;font-weight:900;cursor:pointer;" +
    "background:#38bdf8;color:#0b1220;margin-top:8px;";
  return b;
}

function __criarBtnVermelho(txt) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = txt;
  b.style.cssText =
    "width:100%;padding:14px;border:none;border-radius:16px;font-weight:900;cursor:pointer;" +
    "background:#ef4444;color:#fff;margin-top:8px;";
  return b;
}

function __criarStatusLinha() {
  const s = document.createElement("div");
  s.style.cssText = "margin-top:6px;font-weight:900;opacity:.9;font-size:12px;";
  s.textContent = "status: carregando...";
  return s;
}

function __textoLimpo(v) {
  return String(v || "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function __extrairNomeEmpresaDoBotaoSelecionar(btn) {
  // pega "Selecionar Mini Micro" e retorna "MINI-MICRO"
  const bruto = String(btn?.textContent || "");
  const limpo = __textoLimpo(bruto); // "SELECIONAR MINI MICRO"
  if (!limpo.includes("SELECIONAR")) return "";

  const nome = limpo.replace(/^SELECIONAR\s+/i, "").trim(); // "MINI MICRO"
  if (!nome) return "";
  return (typeof normalizaEmpresaId === "function")
    ? normalizaEmpresaId(nome)
    : nome.replace(/\s+/g, "-");
}

async function __injetarBloqueioEmbaixoDeCadaEmpresa() {
  if (!__isMaster()) return;

  // acha o título mesmo com emoji
  const nodes = Array.from(document.querySelectorAll("div,span,p,h1,h2,h3,h4"));
  const titulo = nodes.find(n => __textoLimpo(n.textContent).includes("EMPRESAS CADASTRADAS"));
  if (!titulo) return;

  // container da lista (pai do titulo normalmente)
  let raiz = titulo.parentElement || document.body;

  // pega SOMENTE os botões "Selecionar ..." originais
  const botoes = Array.from(raiz.querySelectorAll("button"));

  const selecionarBtns = botoes.filter(b => {
    // ignora botões criados por nós
    if (b.dataset && b.dataset.bloqbtn === "1") return false;

    const t = __textoLimpo(b.textContent);

    // pega só botão "Selecionar <empresa>"
    if (!t.startsWith("SELECIONAR ")) return false;
    if (t.includes("SELECIONAR EMPRESA")) return false; // menu
    return true;
  });

  console.log("🔎 empresas detectadas:", selecionarBtns.length);

  for (const btnSel of selecionarBtns) {
    if (btnSel.dataset.__bloqInjected === "1") continue;

    const empId = __extrairNomeEmpresaDoBotaoSelecionar(btnSel);
    if (!empId) continue;

    btnSel.dataset.__bloqInjected = "1";

    const linha = btnSel.parentElement || btnSel;

    // evita duplicar bloco (se já existir logo depois)
    if (linha.nextElementSibling && linha.nextElementSibling.dataset && linha.nextElementSibling.dataset.bloqBlock === "1") {
      continue;
    }

    const bloco = document.createElement("div");
    bloco.dataset.bloqBlock = "1";
    bloco.style.cssText =
      "width:100%;margin-top:10px;padding:10px;border-radius:14px;background:rgba(0,0,0,.20);";

    const status = __criarStatusLinha();

    const btnBloq = __criarBtnVermelho("🔒 BLOQUEAR " + empId);
    btnBloq.dataset.bloqbtn = "1";

    const btnDes  = __criarBtnAzul("🔓 DESBLOQUEAR " + empId);
    btnDes.dataset.bloqbtn = "1";

    btnBloq.onclick = async () => {
      const motivo = prompt("motivo do bloqueio (opcional):", "mensalidade em atraso") || "";
      if (typeof window.masterBloquearEmpresa !== "function") return alert("❌ masterBloquearEmpresa nao existe.");
      await window.masterBloquearEmpresa(empId, motivo);

      const st = await __lerStatusBloqueioEmpresa(empId);
      status.textContent = st.manualBlocked
        ? ("status: 🔒 bloqueada (manual) " + (st.reason ? "- " + st.reason : ""))
        : "status: 🟢 ativa";

      btnBloq.style.display = st.manualBlocked ? "none" : "";
      btnDes.style.display  = st.manualBlocked ? "" : "none";
    };

    btnDes.onclick = async () => {
      if (typeof window.masterDesbloquearEmpresa !== "function") return alert("❌ masterDesbloquearEmpresa nao existe.");
      await window.masterDesbloquearEmpresa(empId);

      const st = await __lerStatusBloqueioEmpresa(empId);
      status.textContent = st.manualBlocked
        ? ("status: 🔒 bloqueada (manual) " + (st.reason ? "- " + st.reason : ""))
        : "status: 🟢 ativa";

      btnBloq.style.display = st.manualBlocked ? "none" : "";
      btnDes.style.display  = st.manualBlocked ? "" : "none";
    };

    bloco.appendChild(status);
    bloco.appendChild(btnBloq);
    bloco.appendChild(btnDes);

    try {
      linha.insertAdjacentElement("afterend", bloco);
    } catch {
      try { linha.appendChild(bloco); } catch {}
    }

    // status inicial
    const st = await __lerStatusBloqueioEmpresa(empId);
    status.textContent = st.manualBlocked
      ? ("status: 🔒 bloqueada (manual) " + (st.reason ? "- " + st.reason : ""))
      : "status: 🟢 ativa";

    btnBloq.style.display = st.manualBlocked ? "none" : "";
    btnDes.style.display  = st.manualBlocked ? "" : "none";

    console.log("✅ bloqueio inserido para:", empId);
  }
}

function ligarGanchoSelecionarEmpresaParaInjetarBloqueio() {
  if (window.__ganchoSelEmpresaLigado) return;
  window.__ganchoSelEmpresaLigado = true;

  setInterval(() => {
    try {
      // procura o botão do menu "Selecionar Empresa"
      const btn = Array.from(document.querySelectorAll("#menu button, button")).find(b =>
        String(b.textContent || "").toUpperCase().includes("SELECIONAR EMPRESA")
      );

      if (!btn) return;

      // evita re-ligar várias vezes
      if (btn.dataset.__hookBloq === "1") return;
      btn.dataset.__hookBloq = "1";

      const old = btn.onclick;
      btn.onclick = async function (...args) {
        // chama o clique original primeiro
        try {
          if (typeof old === "function") await old.apply(this, args);
        } catch {}

        // depois injeta (quando a tela abrir)
        setTimeout(() => {
          try { injetarBloqueioEmpresasAgora(); } catch {}
        }, 200);
      };

      console.log("✅ gancho: Selecionar Empresa ligado");
    } catch {}
  }, 800);
}

// deixa pra testar no console
window.injetarBloqueioEmpresasAgora = __injetarBloqueioEmbaixoDeCadaEmpresa;

function desligarObserverBloqueioEmpresas() {
  try {
    if (window.__obsBloqEmpresas) {
      window.__obsBloqEmpresas.disconnect();
      window.__obsBloqEmpresas = null;
    }
  } catch {}
}

function ligarObserverBloqueioEmpresasCadastradas() {
  if (window.__timerBloqEmpresas) return;

  window.__timerBloqEmpresas = setInterval(() => {
    try { __injetarBloqueioEmbaixoDeCadaEmpresa(); } catch {}
  }, 800);

  // roda já
  try { __injetarBloqueioEmbaixoDeCadaEmpresa(); } catch {}
}

// deixa global pra você testar no console
window.ligarObserverBloqueioEmpresasCadastradas = ligarObserverBloqueioEmpresasCadastradas;
window.injetarBloqueioEmpresasAgora = __injetarBloqueioEmbaixoDeCadaEmpresa;

// =====================
// ✅ sair sem travar o botao entrar
// =====================
function sairDoSistema() {
  try { pararSnapshotAtual(); } catch {}
  try { limparSessao(); } catch {}
  try { mostrarTelaLogin(); } catch {}
  try { habilitarBotaoLogin(); } catch {}
}

function ligarBotaoSairAutomatico() {
  if (window.__hookSairLigado) return;
  window.__hookSairLigado = true;

  const achar = () =>
    Array.from(document.querySelectorAll("#menu button, button"))
      .find(b => String(b.textContent || "").trim().toUpperCase() === "SAIR");

  const btn = achar();
  if (btn) {
    btn.onclick = (e) => { e.preventDefault(); sairDoSistema(); };
    return;
  }

  const obs = new MutationObserver(() => {
    const b = achar();
    if (b) {
      b.onclick = (e) => { e.preventDefault(); sairDoSistema(); };
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

try { ligarBotaoSairAutomatico(); } catch {}

