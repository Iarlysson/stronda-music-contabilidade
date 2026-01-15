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

// ✅ bloqueia segunda execução
if (window.__STRONDA_APP_INIT__) {
  console.warn("⚠️ script.js já foi iniciado. Ignorando segunda execução.");
} else {
  window.__STRONDA_APP_INIT__ = true; // ✅ marca iniciado
  main().catch((e) => console.error("❌ main() falhou:", e));
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
  arrayUnion,            // ✅ ADICIONA ISSO (você usa lá embaixo)
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ✅ Auth (CDN)
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";


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

let __authReady = null;

function ensureAuth() {
  if (__authReady) return __authReady;

  __authReady = new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => {
      if (user) return resolve(user);
      signInAnonymously(auth).catch(reject);
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


// START
iniciarListaMaquinas();
iniciarFormulario();

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
  if (isAdmin()) return;

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

  setPeriodoHojeFechamento();   // ✅ coloca hoje automaticamente
  renderFechamentoCaixa();      // ✅ gera na hora
}
window.abrirFechamentoCaixa = abrirFechamentoCaixa;

async function migrarEmpresaStrondaParaStrondaMusic() {
  await ensureAuth();

  const de = "STRONDA";
  const para = EMPRESA_PRINCIPAL_ID;

  const refDe   = doc(db, "empresas", de, "dados", "app");
  const refPara = doc(db, "empresas", para, "dados", "app");

  const snap = await getDoc(refDe);
  if (!snap.exists()) {
    alert("Não existe dados em STRONDA para migrar.");
    return;
  }

  await setDoc(refPara, snap.data(), { merge: true });
  alert(`Migração concluída: ${de} → ${para}`);
}



function setEmpresaAtual(empresaId) {
  empresaAtualId = normalizaEmpresaId(empresaId || EMPRESA_PRINCIPAL_ID);
  empresaAtual = empresaAtualId;
  localStorage.setItem("empresaAtualId", empresaAtualId);
  docRef = doc(db, "empresas", empresaAtualId, "dados", "app");
  atualizarNomeEmpresaNaTela().catch(console.error);
  return empresaAtualId;
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
  if (typeof unsubSnapshot === "function") {
    try { unsubSnapshot(); } catch {}
  }
  unsubSnapshot = null;
  __syncAtivo = false;
  __syncIniciando = false;
}




// =====================
// ✅ STATUS DE ACERTOS
// =====================
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

  // ✅ só máquinas que NÃO são depósito
  const ativas = (maquinas || []).filter(m => normalizarStatus(m.status) !== "DEPOSITO");

  // ✅ 1 por estabelecimento
  const unicos = new Map();
  ativas.forEach(m => {
    const key = String(m.estab || "").toUpperCase().trim();
    if (!unicos.has(key)) unicos.set(key, m);
  });

  const lista = [...unicos.values()];

  if (!lista.length) {
    listaStatus.innerHTML = "<li>✅ Nenhuma máquina ALUGADA</li>";
    return;
  }

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

    const li = document.createElement("li");
    li.style.position = "relative";
    li.style.borderRadius = "12px";
    li.style.background = "#0f172a";
    li.style.cursor = "pointer";
    li.style.marginBottom = "10px";

    // ✅ reserva espaço pro botão 📍 no canto direito
    li.style.padding = "14px 44px 14px 14px";

    // ✅ linha única, usando o espaço todo
    const linha = document.createElement("div");
    linha.style.display = "flex";
    linha.style.alignItems = "center";
    linha.style.gap = "10px";
    linha.style.whiteSpace = "nowrap";
    linha.style.overflow = "hidden";
    linha.style.textOverflow = "ellipsis";

    // bolinha status
    const bol = document.createElement("span");
    bol.textContent = teveAcerto ? "🟢" : "🔴";
    bol.style.flex = "0 0 auto";

    // texto principal: ESTABELECIMENTO
    const nome = document.createElement("span");
    nome.textContent = estabKey;
    nome.style.fontWeight = "900";
    nome.style.fontSize = "16px";
    nome.style.flex = "1 1 auto";
    nome.style.overflow = "hidden";
    nome.style.textOverflow = "ellipsis";

    // texto secundário: JB Nº
    const jb = document.createElement("span");
    jb.textContent = `JB Nº ${String(m.numero || "").toUpperCase()}`;
    jb.style.fontWeight = "800";
    jb.style.fontSize = "14px";
    jb.style.opacity = "0.9";
    jb.style.flex = "0 0 auto";

    linha.appendChild(bol);
    linha.appendChild(nome);
    linha.appendChild(jb);

    // clicar no card abre detalhes
    li.onclick = () => {
      if (typeof abrirDetalhesCliente === "function") abrirDetalhesCliente(m.estab);
    };

    // botão GPS pequeno no canto
    const lat = toNumberCoord(m.lat);
    const lng = toNumberCoord(m.lng);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "📍";

    btn.style.position = "absolute";
    btn.style.top = "10px";
    btn.style.right = "10px";
    btn.style.width = "28px";
    btn.style.height = "28px";
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.padding = "0";
    btn.style.margin = "0";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "18px";
    btn.style.lineHeight = "28px";
    btn.style.opacity = "0.9";

    btn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation(); // não abre detalhes
      if (lat == null || lng == null) return alert("❌ Sem GPS salvo.");
      abrirNoMaps(lat, lng);
    };

    li.appendChild(linha);
    li.appendChild(btn);
    listaStatus.appendChild(li);
  });
}




// salvar crédito remoto: soma no relógio anterior (ultimoRelogio)
function salvarCreditoRemoto() {
  if (!exigirAdmin()) return;

  const num = (document.getElementById("crNum")?.value || "").trim().toUpperCase();
  const valor = Number(document.getElementById("crValor")?.value || 0);

  if (!num) return alert("❌ Digite o número da máquina.");
  if (!valor || valor <= 0) return alert("❌ Digite um valor válido (maior que 0).");

  const m = maquinas.find(x => String(x.numero || "").toUpperCase() === num);
  if (!m) return alert("❌ Máquina não encontrada.");

  // relógio atual
  const atual = m.ultimoRelogio != null ? Number(m.ultimoRelogio) : 0;
  const novo = atual + valor;

  // atualiza relógio
  m.ultimoRelogio = novo;

  // registra histórico (opcional, mas recomendado)
  if (!Array.isArray(m.creditosRemotos)) m.creditosRemotos = [];

  m.creditosRemotos.push({
    id: Date.now(),
    valor: valor,
    antes: atual,
    depois: novo,
    data: new Date().toISOString(),
  });

  salvarNoFirebase();



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


function desabilitarBotaoLogin() {
  const btn = document.getElementById("btnEntrar");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "⏳ Carregando...";
  btn.style.opacity = "0.7";
}

function habilitarBotaoLogin() {
  const btn = document.getElementById("btnEntrar");
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = "Entrar";
  btn.style.opacity = "1";
}

desabilitarBotaoLogin();




let carregandoDoFirebase = false;
let __rotinaRodouPorEmpresa = {}; // { "EMPRESA_PRINCIPAL_ID": true, ... }

function rodarRotinasApenasUmaVezPorEmpresa() {
  const emp = String(empresaAtualId || EMPRESA_PRINCIPAL_ID).toUpperCase();

  // já rodou pra essa empresa? então não faz nada
  if (__rotinaRodouPorEmpresa[emp]) return;
  __rotinaRodouPorEmpresa[emp] = true;

  // ⚠️ roda UMA vez só (não em todo snapshot)
  //try { migrarLocalStorageParaFirebaseSePreciso(); } catch(e) { console.log(e); }
 // try { garantirAdminPadrao().catch(console.error); } catch(e) { console.log(e); }
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



async function salvarNoFirebase(force = false) {
  if (__firestoreBloqueado && !force) return false;
  if (!firebasePronto || !docRef) return false;

  // ✅ trava saves por 1 minuto quando quota estourar
  if (!force && Date.now() < __pauseSaveUntil) {
    return false;
  }

  // se snapshot tá carregando, só permite se for force
  if (carregandoDoFirebase && !force) {
    __savePendente = true;
    return false;
  }

  clearTimeout(__saveTimer);

  const delay = force ? 400 : 4000;


  return new Promise((resolve) => {
    __saveTimer = setTimeout(async () => {
      if (__saving) {
        __queued = true;
        resolve(true);
        return;
      }

      const core = { ocorrencias, maquinas, acertos, usuarios };
      const coreStr = JSON.stringify(core);

      if (coreStr === __lastCoreStr) {
        resolve(true);
        return;
      }

      __saving = true;

      try {
        salvarBackupLocal();

        await setDoc(
          docRef,
          { atualizadoEm: new Date().toISOString(), ...core },
          { merge: true }
        );

        __lastCoreStr = coreStr;
        __backoffMs = 0;
        __saving = false;

        if (__queued) {
          __queued = false;
          salvarNoFirebase(true);
        }

        resolve(true);
      } catch (err) {
        console.error("❌ Firebase save error:", err);

        const isQuota =
          String(err?.code || "").includes("resource-exhausted") ||
          /quota/i.test(String(err?.message || ""));

        __saving = false;

        if (isQuota) {
          // ✅ PAUSA saves por 60s
          __pauseSaveUntil = Date.now() + 60000;

          const now = Date.now();
          if (now - __lastQuotaWarnAt > 20000) {
            __lastQuotaWarnAt = now;
            alert("⚠️ Firestore estourou a quota.\nVou pausar salvamentos por 1 minuto para evitar travamento.\n\n✅ Seus dados continuam salvos no backup local.");
          }

          // ✅ NUNCA repetir infinito
          __queued = false;
          resolve(false);
          return;
        }

        alert("❌ Não consegui salvar no Firebase.\n\n" + (err?.message || err));
        resolve(false);
      }
    }, delay);
  });
}

  async function carregarDadosUmaVezParaLogin() {
  console.log("🚀 carregarDadosUmaVezParaLogin() começou");

  try {
    await ensureAuth();

    if (!docRef) {
      const emp = localStorage.getItem("empresaAtualId") || EMPRESA_PRINCIPAL_ID;
      setEmpresaAtual(emp);
    }

    await garantirDocExiste();

    const snap = await getDoc(docRef);
    const data = snap.exists() ? (snap.data() || {}) : {};

    empresaPerfil = data.empresaPerfil || {}; // ✅ ADD
    ocorrencias = Array.isArray(data.ocorrencias) ? data.ocorrencias : [];
    maquinas    = Array.isArray(data.maquinas) ? data.maquinas.map(normalizarGPSMaquina) : [];
    acertos     = Array.isArray(data.acertos) ? data.acertos : [];
    usuarios    = Array.isArray(data.usuarios) ? data.usuarios : [];

    salvarBackupLocal();

    firebasePronto = true;
    habilitarBotaoLogin();

    console.log("✅ carregarDadosUmaVezParaLogin() terminou OK");
    return true;

  } catch (e) {
    console.error("carregarDadosUmaVezParaLogin erro:", e);

    const ok = carregarBackupLocal();
    firebasePronto = true;
    habilitarBotaoLogin();

    if (!ok) {
      alert("⚠️ Não consegui carregar do Firebase e não achei backup local.");
    }

    console.log("⚠️ carregarDadosUmaVezParaLogin() terminou com erro");
    return false;
  }
}



async function iniciarSincronizacaoFirebase() {
  if (__firestoreBloqueado) return;

  // garante docRef
  if (!docRef) {
    const emp = localStorage.getItem("empresaAtualId") || EMPRESA_PRINCIPAL_ID;
setEmpresaAtual(emp);
  }

  // se não está logado, só carrega uma vez pro login (sem snapshot)
  if (!sessaoUsuario) {
    await carregarDadosUmaVezParaLogin();
    await atualizarNomeEmpresaNaTela();
    return;
  }

  // evita reentrância
  if (__syncAtivo || __syncIniciando) return;

  __syncIniciando = true;

  try {
    await ensureAuth();
    await garantirDocExiste();

    // ✅ sempre para o snapshot ANTES de ligar outro
    pararSnapshotAtual();

    carregandoDoFirebase = true;

    // ✅ agora sim liga e guarda o unsub
    unsubSnapshot = onSnapshot(
      docRef,
      (snap) => {
        carregandoDoFirebase = false;

        const data = snap.exists() ? (snap.data() || {}) : {};
          
        empresaPerfil = data.empresaPerfil || {}; // ✅ ADD
        if (Array.isArray(data.ocorrencias)) ocorrencias = data.ocorrencias;
        if (Array.isArray(data.maquinas))    maquinas    = data.maquinas.map(normalizarGPSMaquina);
        if (Array.isArray(data.acertos))     acertos     = data.acertos;
        if (Array.isArray(data.usuarios))    usuarios    = data.usuarios;

        salvarBackupLocal();

        firebasePronto = true;
        habilitarBotaoLogin();

        try { listarMaquinas(); } catch {}
        try { atualizarStatus(); } catch {}
        try { listarOcorrencias(); } catch {}
        try { atualizarAlertaOcorrencias(); } catch {}

        rodarRotinasApenasUmaVezPorEmpresa();
      },
      (err) => {
        carregandoDoFirebase = false;

        console.error("❌ Firebase snapshot error:", err);

        if (isQuotaErr(err)) {
          entrarModoOfflinePorQuota(err);
          return;
        }

        firebasePronto = true;
        habilitarBotaoLogin();

        const ok = carregarBackupLocal();
        if (ok) {
          try { listarMaquinas(); } catch {}
          try { atualizarStatus(); } catch {}
          try { listarOcorrencias(); } catch {}
        }

        alert(
          "❌ Firebase não conectou.\n\n" +
          (err?.message || err) +
          (ok ? "\n\n✅ Mostrei seus dados do backup local." : "\n\n⚠️ Não achei backup local dessa empresa.")
        );
      }
    );

    // ✅ marcou ativo APÓS ter unsub
    __syncAtivo = true;

  } catch (e) {
    carregandoDoFirebase = false;
    firebasePronto = false;
    desabilitarBotaoLogin();
    console.error("❌ Falha iniciar Firebase:", e);

    if (isQuotaErr(e)) {
      entrarModoOfflinePorQuota(e);
      return;
    }

    alert("❌ Falha ao iniciar Firebase.\n\n" + (e?.message || e));
  } finally {
    __syncIniciando = false;
  }
}

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

  // ❌ NÃO salvar persistente
  // localStorage.setItem("sessaoUsuario", JSON.stringify(sessaoUsuario));

  window.__sessao = sessaoUsuario;
}


function isAdmin() {
  const t = String(sessaoUsuario?.tipo || "").toUpperCase();
  return t === "ADMIN" || t === "MASTER";
}

function isMaster() {
  const t = String(sessaoUsuario?.tipo || "").toUpperCase();
  return t === "MASTER";
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


// bloqueio simples: se não for admin, não entra
function exigirAdmin() {
  if (!isLogado()) {
    alert("❌ Faça login primeiro.");
    mostrarTelaLogin();
    limparCamposLogin();
    return false;
  }
  if (!isAdmin()) {
    alert("❌ Apenas ADMIN pode acessar isso.");
    return false;
  }
  return true;
}

function aplicarPermissoesMenu() {
  const btnSel = document.getElementById("btnSelecionarEmpresa");
  if (btnSel) btnSel.style.display = isMaster() ? "block" : "none";

  const btnVoltar = document.getElementById("btnVoltarStronda");
  if (btnVoltar) btnVoltar.style.display = isMaster() ? "block" : "none";

  const btnAR = document.getElementById("btnAtualizarRelogio");
  if (btnAR) btnAR.style.display = isAdmin() ? "block" : "none"; // ADMIN+MASTER

  // ✅ Créditos Remotos: só ADMIN + MASTER
  const btnCR = document.getElementById("btnCreditosRemotos");
  if (btnCR) btnCR.style.display = isAdmin() ? "block" : "none";

    // ✅ Colaboradores: só ADMIN + MASTER
  const btnColabs = document.getElementById("btnColaboradores");
  if (btnColabs) btnColabs.style.display = isAdmin() ? "block" : "none";
  
  // ✅ Cadastrar Máquina: só ADMIN + MASTER
  const btnCadMaq = document.getElementById("btnCadastrarMaquina");
  if (btnCadMaq) btnCadMaq.style.display = isAdmin() ? "block" : "none";


  // ✅ Trocar Senha (ADMIN): só ADMIN + MASTER
  const btnTS = document.getElementById("btnTrocarSenhaAdmin");
  if (btnTS) btnTS.style.display = isAdmin() ? "block" : "none";

  // ✅ (se tiver) Fechamento de Caixa: só ADMIN + MASTER
  const btnFC = document.getElementById("btnFechamentoCaixa");
  if (btnFC) btnFC.style.display = isAdmin() ? "block" : "none";

    // ✅ Trocar Credenciais MASTER: só MASTER
  const btnTM = document.getElementById("btnTrocarCredenciaisMaster");
  if (btnTM) btnTM.style.display = isMaster() ? "block" : "none";

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
  if (isAdmin()) return; // admin/master vê

  // botão do menu (principal)
  const btnMenu = document.getElementById("btnCadastrarMaquina");
  if (btnMenu) btnMenu.style.display = "none";

  // se existir algum botão de cadastrar máquina DENTRO da tela de colaboradores
  const btnDentro = document.querySelector("#colaboradores #btnCadastrarMaquina, #colaboradores .btnCadastrarMaquina");
  if (btnDentro) btnDentro.style.display = "none";
}


function newId() {
  return (crypto?.randomUUID?.() || (Date.now() + "_" + Math.random().toString(16).slice(2)));
}

async function migrarLocalStorageParaFirebaseSePreciso() {
  try {
    const emp = String(empresaAtualId || EMPRESA_PRINCIPAL_ID).toUpperCase();
    const chave = "MIGROU_LOCAL_PARA_FIREBASE_" + emp;

    if (localStorage.getItem(chave) === "1") return;
    if (!firebasePronto || !docRef) return;

    // confirma estado REAL do Firebase agora (evita “corrida”)
    const snap = await getDoc(docRef);
    const dataFb = snap.exists() ? (snap.data() || {}) : {};

    const fbTemAlgo =
      (Array.isArray(dataFb.maquinas) && dataFb.maquinas.length) ||
      (Array.isArray(dataFb.acertos) && dataFb.acertos.length) ||
      (Array.isArray(dataFb.ocorrencias) && dataFb.ocorrencias.length) ||
      (Array.isArray(dataFb.usuarios) && dataFb.usuarios.length);

    if (fbTemAlgo) {
      localStorage.setItem(chave, "1");
      return;
    }

    const m = JSON.parse(localStorage.getItem("maquinas") || "[]");
    const a = JSON.parse(localStorage.getItem("acertos") || "[]");
    const o = JSON.parse(localStorage.getItem("ocorrencias") || "[]");
    const u = JSON.parse(localStorage.getItem("usuarios") || "[]");

    const temLocal = (m.length || a.length || o.length || u.length);
    if (!temLocal) {
      localStorage.setItem(chave, "1");
      return;
    }

    maquinas = Array.isArray(m) ? m.map(normalizarGPSMaquina) : [];
    acertos = Array.isArray(a) ? a : [];
    ocorrencias = Array.isArray(o) ? o : [];
    usuarios = Array.isArray(u) ? u : [];

    const ok = await salvarNoFirebase(true);
    if (ok) {
      localStorage.setItem(chave, "1");
      alert("✅ Migrei seus dados do localStorage para o Firebase!");
    } else {
      console.warn("⚠️ Migração falhou (save).");
    }
  } catch (e) {
    console.log("Falha migrar:", e);
  }
}

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
  // garante firebase auth pra conseguir ler o índice
  try { await ensureAuth(); } catch (e) {}

  tipo = String(tipo || "").toUpperCase();
  if (tipo.includes("ADMIN")) tipo = "ADMIN";
  if (tipo.includes("COLAB")) tipo = "COLAB";

  const user = (document.getElementById("loginUser")?.value || "").trim().toLowerCase();
  const senha = (document.getElementById("loginSenha")?.value || "").trim();

  if (!user || !senha) return alert("❌ Preencha usuário e senha.");

  // ✅ 1) consulta índice central (descobre empresa/tipo sem depender da empresa atual)
  let info = null;
  try {
    info = await buscarLoginIndex(user);
  } catch (e) {
    console.error("buscarLoginIndex erro:", e);
  }

  if (!info) return alert("❌ Usuário não encontrado.");

  const tipoReal = String(info.tipo || "").toUpperCase();
  const empresaDoUser = String(info.empresaId || "").toUpperCase();
  const senhaReal = String(info.senha || "");

  if (senhaReal !== senha) return alert("❌ Login inválido.");

  // valida tela escolhida vs tipo real
  if (tipo === "ADMIN" && !(tipoReal === "ADMIN" || tipoReal === "MASTER")) {
    return alert("❌ Esse usuário não é ADMIN.");
  }
  if (tipo === "COLAB" && tipoReal !== "COLAB") {
    return alert("❌ Esse usuário não é COLAB.");
  }

 // ✅ 2) MASTER NÃO troca empresa. ADMIN/COLAB troca.
pararSnapshotAtual();

if (tipoReal === "MASTER") {
  setEmpresaAtual(EMPRESA_PRINCIPAL); // EMPRESA_PRINCIPAL_ID
} else {
  setEmpresaAtual(empresaDoUser);     // empresa do admin/colab
}

// sempre carrega dados da empresa atual (a que estiver selecionada)
firebasePronto = false;
desabilitarBotaoLogin();
await carregarDadosUmaVezParaLogin();
habilitarBotaoLogin();


  // ✅ 3) pega o usuário real dentro do doc da empresa (pra usar seu salvarSessao(u) igual)
  const u = (usuarios || []).find(x =>
    String(x.user || "").toLowerCase() === user &&
    String(x.senha || "") === senha &&
    String(x.tipo || "").toUpperCase() === tipoReal
  );

  // fallback: se por algum motivo não achou, cria objeto mínimo
  const userObj = u || {
  tipo: tipoReal,
  nome: String(tipoReal),
  user,
  senha,
  empresaId: (tipoReal === "MASTER" ? EMPRESA_PRINCIPAL : empresaDoUser)
};


  salvarSessao(userObj);

// ✅ APLICA CLASSE NO BODY (isso destrava o menu ADMIN)
aplicarClassePermissaoBody();

// ✅ garante menu certo
aplicarPermissoesMenu();
aplicarPermissoesUI();
esconderBotaoCadastrarMaquina();
ativarProtecaoCadastroMaquina();



  // ✅ 4) liga snapshot normalmente
  pararSnapshotAtual();
  __syncAtivo = false;
  iniciarSincronizacaoFirebase();

  if (userObj.tipo === "COLAB") {
  const nomeBonito = await getNomeBonitoEmpresa(userObj.empresaId);
  alert("✅ Entrou na empresa: " + (nomeBonito || userObj.empresaId || "SEM EMPRESA"));
}


  mostrarApp();
  aplicarPermissoesUI();
  aplicarPermissoesMenu();
  atualizarAlertaOcorrencias();
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




function normalizarStatus(s) {
  return (s || "ALUGADA")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // tira acento: DEPÓSITO -> DEPOSITO
}

function _normTxt(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toUpperCase()
    .trim();
}

function esconderCadastroMaquinaParaColab() {
  if (isAdmin()) return; // admin/master vê

  // tenta achar o container do menu (ajuste aqui se tiver um id/classe específico)
  const menu =
    document.getElementById("menu") ||
    document.getElementById("sidebar") ||
    document.querySelector(".menu") ||
    document.querySelector(".sidebar") ||
    document.body;

  const alvo = _normTxt("Cadastro de Máquina"); // vira "CADASTRO DE MAQUINA"

  // pega itens clicáveis do menu
  const itens = menu.querySelectorAll("button, a, [role='button'], .btn, li, div");

  itens.forEach(el => {
    const t = _normTxt(el.textContent);
    if (t.includes(alvo)) {
      el.style.display = "none";
    }
  });
}

function ativarProtecaoCadastroMaquina() {
  // roda já
  esconderCadastroMaquinaParaColab();

  // roda sempre que algo mudar no DOM (menu sendo recriado)
  const obs = new MutationObserver(() => esconderCadastroMaquinaParaColab());
  obs.observe(document.body, { childList: true, subtree: true });
}


function abrir(id) {
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

  if (id === "colaboradores") {
  try { listarColaboradores(); } catch(e) { console.log(e); }
}

if (id === "colaboradores") {
  try { esconderBotaoCadastrarMaquina(); } catch(e) {}
}


if (id === "selecionarEmpresa") {
  listarEmpresasUI().catch(console.error);
}
}


function voltar() {
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
   CADASTRO DE MÁQUINA
   (NÃO MEXE NA LÓGICA QUE JÁ FUNCIONOU)
====================== */
async function salvarMaquina() {
  const numero = $("numMaquina").value.trim().toUpperCase();
  const estab = $("nomeEstab").value.trim().toUpperCase();
  const cliente = ($("nomeCliente")?.value || "").trim().toUpperCase();
  const enderecoTxt = ($("endereco")?.value || "").trim().toUpperCase();
  const porc = Number($("porcBase")?.value || 0);
  const fone = ($("foneCliente")?.value || "").trim();

  const nums = fone.replace(/\D/g, "").slice(0, 11);
  const ddd = nums.slice(0, 2);
  const tel = nums.slice(2);

  if (!numero || !estab) {
    alert("❌ Preencha o número da jukebox e o estabelecimento");
    return;
  }

  const numeroExiste = maquinas.some((m) => String(m.numero).toUpperCase() === numero);
  if (numeroExiste) {
    alert("⚠️ Essa jukebox já está cadastrada");
    return;
  }

  const lat = cadastroGeoTemp?.lat ?? null;
  const lng = cadastroGeoTemp?.lng ?? null;

  maquinas.push({
    numero,
    estab,
    cliente,
    endereco: enderecoTxt,
    porcBase: porc,
    ddd,
    tel,
    foneFormatado: (typeof formatarTelefoneBR === "function" ? formatarTelefoneBR(fone) : String(fone || "")),
    lat,
    lng,
    resetStatusAt: null,
  });

  cadastroGeoTemp = null;

  await salvarNoFirebase(true); // ou salvarNoFirebase()

  alert("✅ Máquina cadastrada com sucesso");
  voltar();

  $("numMaquina").value = "";
  $("nomeEstab").value = "";
  if ($("nomeCliente")) $("nomeCliente").value = "";
  if ($("endereco")) $("endereco").value = "";
  if ($("porcBase")) $("porcBase").value = "";
  if ($("foneCliente")) $("foneCliente").value = "";
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
    atualizarPreviewAcerto();
    return;
  }

  const maquina = maquinas.find((m) => String(m.numero).toUpperCase() === numeroDigitado);

  if (maquina) {
    campoEstab.value = String(maquina.estab || "").toUpperCase();

    // ✅ aqui é o pulo do gato: coloca o último relógio como "anterior"
    if (rAnt) rAnt.value = maquina.ultimoRelogio != null ? String(maquina.ultimoRelogio) : "";
  } else {
    campoEstab.value = "";
    if (rAnt) rAnt.value = "";
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
    atualizarPreviewAcerto();
    return;
  }

  const maquina = maquinas.find((m) => String(m.estab).toUpperCase() === estabDigitado);

  if (maquina) {
    campoNum.value = String(maquina.numero || "").toUpperCase();

    // ✅ aqui também: coloca o último relógio como "anterior"
    if (rAnt) rAnt.value = maquina.ultimoRelogio != null ? String(maquina.ultimoRelogio) : "";
  } else {
    campoNum.value = "";
    if (rAnt) rAnt.value = "";
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

/* ===== SALVAR ACERTO ===== */
function salvarAcerto() {
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
    data: new Date().toISOString(),
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
  const yyyy = hoje.getFullYear();
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  const dd = String(hoje.getDate()).padStart(2, "0");
  const v = `${yyyy}-${mm}-${dd}`;

  ini.value = v;
  fim.value = v;

  renderFechamentoCaixa();
}

function fcSetMensalAtual() {
  const ini = document.getElementById("fcIni");
  const fim = document.getElementById("fcFim");
  if (!ini || !fim) return;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth(); // 0-11

  const first = new Date(yyyy, mm, 1);
  const last = new Date(yyyy, mm + 1, 0);

  const f1 = `${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,"0")}-${String(first.getDate()).padStart(2,"0")}`;
  const f2 = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`;

  ini.value = f1;
  fim.value = f2;

  renderFechamentoCaixa();
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


// ====== LISTA DE MÁQUINAS ======
function listarMaquinas() {
  const listaMaquinas = $("listaMaquinas");
  if (!listaMaquinas) return;

  listaMaquinas.innerHTML = "";

  if (!maquinas.length) {
    listaMaquinas.innerHTML = "<li>Nenhuma máquina cadastrada</li>";
    return;
  }

  maquinas.forEach((m) => {
    const status = (m.status || "ALUGADA").toUpperCase();
    const li = document.createElement("li");
    li.textContent = `${String(m.estab).toUpperCase()} (JB Nº ${String(m.numero).toUpperCase()}) — ${status}`;
    li.style.cursor = "pointer";

    // ✅ clicar abre detalhes/edição
    li.onclick = () => abrirDetalheMaquina(m.numero);

    listaMaquinas.appendChild(li);
  });
}


// ====== ABRIR DETALHE ======
function abrirDetalheMaquina(numero) {
  maquinaSelecionadaNumero = String(numero || "").trim().toUpperCase();

  abrir("detalheMaquina"); // ou o id certo da sua tela de detalhe

  const m = maquinas.find(x => String(x.numero || "").toUpperCase() === maquinaSelecionadaNumero);
  if (!m) {
    alert("Máquina não encontrada");
    voltar();
    return;
  }

  // preencher campos
  const tituloMaquina = document.getElementById("tituloMaquina");
  const detNumero   = document.getElementById("detNumero");
  const detEstab    = document.getElementById("detEstab");
  const detCliente  = document.getElementById("detCliente");
  const detEndereco = document.getElementById("detEndereco");
  const detStatus   = document.getElementById("detStatus");
  const detFone     = document.getElementById("detFone");


    // ✅ comportamento automático DEPÓSITO
  function aplicarUIStatusDeposito() {
    const st = detStatus?.value || "ALUGADA";
    const dep = isDepositoStatus(st);

    if (dep) {
      if (detEstab) {
        detEstab.value = labelDeposito();
        detEstab.disabled = true;
        detEstab.readOnly = true;
        detEstab.style.opacity = "0.7";
        detEstab.style.cursor = "not-allowed";
        detEstab.title = "DEPÓSITO preenche automático";
      }

      if (detCliente) {
        detCliente.value = ""; // ✅ apaga cliente
        detCliente.disabled = true;
        detCliente.readOnly = true;
        detCliente.style.opacity = "0.7";
        detCliente.style.cursor = "not-allowed";
        detCliente.title = "DEPÓSITO não usa cliente";
      }
    } else {
      // volta ao normal
      if (detEstab) {
        detEstab.disabled = false;
        detEstab.readOnly = false;
        detEstab.style.opacity = "1";
        detEstab.style.cursor = "text";
        detEstab.title = "";
      }

      if (detCliente) {
        detCliente.disabled = false;
        detCliente.readOnly = false;
        detCliente.style.opacity = "1";
        detCliente.style.cursor = "text";
        detCliente.title = "";
      }
    }
  }

  if (detStatus) {
    detStatus.onchange = aplicarUIStatusDeposito;
    aplicarUIStatusDeposito(); // ✅ roda ao abrir a tela
  }

  if (tituloMaquina) tituloMaquina.textContent = `🔧 ${m.estab} (JB Nº ${m.numero})`;

  if (detNumero)  detNumero.value  = String(m.numero || "");

  if (detNumero) {
  detNumero.value = String(m.numero || "");

  // ✅ TRAVA: número não pode mudar (nem colab, nem admin)
  detNumero.readOnly = true;
  detNumero.disabled = true;
  detNumero.style.opacity = "0.7";
  detNumero.style.cursor = "not-allowed";
  detNumero.title = "Número não pode ser alterado";
}


  if (detEstab)   detEstab.value   = String(m.estab || "").toUpperCase();
  if (detCliente) detCliente.value = String(m.cliente || "").toUpperCase();

  // endereço/gps
  if (detEndereco) {
    if (m.lat != null && m.lng != null) detEndereco.value = `LAT:${Number(m.lat).toFixed(6)} | LNG:${Number(m.lng).toFixed(6)}`;
    else detEndereco.value = String(m.endereco || "").toUpperCase();
  }

  if (detStatus) detStatus.value = (m.status || "ALUGADA");
  if (detFone) detFone.value = pegarTelefoneDaMaquina(m);

  // maiúsculas ao digitar
  if (detEstab)   detEstab.oninput   = () => detEstab.value = detEstab.value.toUpperCase();
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
    return;
  }

  // procura a máquina
  const m = maquinas.find(x => String(x.numero).toUpperCase() === numeroInput);

  // não achou
  if (!m) {
    maquinaSelecionadaNumero = null;
    if (detEstab) detEstab.value = "";
    if (detCliente) detCliente.value = "";
    if (detEndereco) detEndereco.value = "";
    if (detStatus) detStatus.value = "ALUGADA";
    if (detFone) detFone.value = "";
    if (tituloMaquina) tituloMaquina.textContent = `🔧 Máquina não encontrada`;
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
}

let maquinaSelecionadaNumero = null;
 

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
  const rel = Number(document.getElementById("arRelogioAtual")?.value || 0);

  if (!num) return alert("❌ Digite o número da máquina.");
  if (!Number.isFinite(rel) || rel <= 0) return alert("❌ Digite um relógio válido (maior que 0).");

  const m = (maquinas || []).find(x => String(x.numero || "").toUpperCase() === num);
  if (!m) return alert("❌ Máquina não encontrada.");

  const antes = m.ultimoRelogio != null ? Number(m.ultimoRelogio) : 0;

  // ✅ não deixa baixar relógio (se quiser permitir, remova essa trava)
  if (rel < antes) {
    return alert(`❌ Relógio Atual não pode ser menor que o anterior.\nAnterior: ${antes.toFixed(2)}`);
  }

  m.ultimoRelogio = rel;

  // histórico opcional
  if (!Array.isArray(m.historicoRelogio)) m.historicoRelogio = [];
  m.historicoRelogio.push({
    id: Date.now(),
    antes,
    depois: rel,
    data: new Date().toISOString(),
    por: sessaoUsuario?.user || "admin"
  });

  await salvarNoFirebase(true);

  alert(`✅ Relógio atualizado!\n\n${m.estab}\nJB Nº ${m.numero}\n\n${antes.toFixed(2)} → ${rel.toFixed(2)}`);

  // limpa campos
  const arNum = document.getElementById("arNum");
  const arEstab = document.getElementById("arEstab");
  const arCliente = document.getElementById("arCliente");
  const arRel = document.getElementById("arRelogioAtual");

  if (arNum) arNum.value = "";
  if (arEstab) arEstab.value = "";
  if (arCliente) arCliente.value = "";
  if (arRel) arRel.value = "";

  voltar();
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



function salvarAlteracoesMaquina() {
  if (!exigirLogado()) return; // ✅ colab pode salvar

  const m = maquinas.find(x => x.numero == maquinaSelecionadaNumero);
  if (!m) return alert("Máquina não encontrada");

  const detEstab = document.getElementById("detEstab");
  const detCliente = document.getElementById("detCliente");
  const detEndereco = document.getElementById("detEndereco");
  const detStatus = document.getElementById("detStatus");
  const detFone = document.getElementById("detFone");

  const estabAntigo   = (m.estab || "").toUpperCase().trim();
  const clienteAntigo = (m.cliente || "").toUpperCase().trim();

  const statusNovo = (detStatus?.value || "ALUGADA");

  let estabNovo    = (detEstab?.value || "").trim().toUpperCase();
  let clienteNovo  = (detCliente?.value || "").trim().toUpperCase();
  const enderecoNovo = (detEndereco?.value || "").trim().toUpperCase();

  // ✅ SE for DEPÓSITO: força estab e apaga cliente
  if (isDepositoStatus(statusNovo)) {
    estabNovo = labelDeposito(); // ✅ DEPOSITO EMPRESA_PRINCIPAL_ID (na principal)
    clienteNovo = "";            // ✅ apaga cliente
  }

  if (!estabNovo) return alert("❌ O estabelecimento não pode ficar vazio");

  // ✅ NÃO trava duplicado quando for DEPÓSITO
  if (!isDepositoStatus(statusNovo)) {
    const duplicado = maquinas.some(x =>
      x.numero != m.numero &&
      normalizarStatus(x.status) !== "DEPOSITO" &&          // ✅ ignora depósitos
      String(x.estab || "").toUpperCase().trim() === estabNovo
    );
    if (duplicado) return alert("⚠️ Já existe uma máquina com esse estabelecimento");
  }

  // ✅ atualiza dados básicos
  m.estab = estabNovo;
  m.cliente = clienteNovo;
  m.endereco = enderecoNovo;
  m.status = statusNovo;

  // ✅ TELEFONE
  const foneDigitado = (detFone?.value || "").trim();
  const nums = foneDigitado.replace(/\D/g, "").slice(0, 11);
  m.ddd = nums.slice(0, 2);
  m.tel = nums.slice(2);
  m.foneFormatado = formatarTelefoneBR(nums);

  // (se quiser apagar acertos quando muda estab/cliente)
  if (estabAntigo !== estabNovo || clienteAntigo !== clienteNovo) {
    acertos = acertos.filter(a =>
      String(a.estab || "").toUpperCase().trim() !== estabAntigo
    );
  }

  salvarNoFirebase();

  alert("✅ Alterações salvas!");

  const titulo = document.getElementById("tituloMaquina");
  if (titulo) titulo.textContent = `🔧 ${m.estab} (JB Nº ${m.numero})`;
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

function renderFechamentoCaixa() {
  const outResumo = document.getElementById("fcResumo");
  const outLista  = document.getElementById("fcLista");
  const iniEl = document.getElementById("fcIni");
  const fimEl = document.getElementById("fcFim");

  if (!outResumo || !outLista || !iniEl || !fimEl) return;

  if (!iniEl.value || !fimEl.value) {
    outResumo.innerHTML = `
      <div style="background:#0f172a; padding:12px; border-radius:12px;">
        ❌ Selecione <b>Data inicial</b> e <b>Data final</b>.
      </div>`;
    outLista.innerHTML = "";
    return;
  }

  const dtIni = toDateLocal(iniEl.value, false);
  const dtFim = toDateLocal(fimEl.value, true);

  // ✅ filtra acertos no período
  const lista = (acertos || []).filter(a => {
    const d = new Date(a.data);
    return d >= dtIni && d <= dtFim;
  });

  if (!lista.length) {
    outResumo.innerHTML = `
      <div style="background:#0f172a; padding:12px; border-radius:12px;">
        ✅ Nenhum acerto no período.
      </div>`;
    outLista.innerHTML = "";
    return;
  }

  // ==========================
  // ✅ Totais (EMPRESA, sem cliente)
  // ==========================
  let totalEmpresa = 0;
  let totalPix = 0;
  let totalEspecieEmpresa = 0;
  let totalARecolher = 0;
  let totalARepassar = 0;

  // agrupador conforme modo
  const grupo = new Map(); // chave -> acumulados

  lista.forEach(a => {
    const emp = Number(a.empresa || 0);
    const pix = Number(a.pix || 0);

    // espécie da empresa = max(0, empresa - pix)
    const espEmpresa = Math.max(0, emp - pix);

    const recolher = Number(a.especieRecolher || 0);
    const repassar = Number(a.repassarCliente || 0);

    totalEmpresa += emp;
    totalPix += pix;
    totalEspecieEmpresa += espEmpresa;
    totalARecolher += recolher;
    totalARepassar += repassar;

    const d = new Date(a.data);

    // chave do agrupamento
    let key = "";
    if (__fcModo === "MENSAL") {
      // yyyy-mm
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    } else {
      // DIARIO -> yyyy-mm-dd
      key = d.toISOString().slice(0,10);
    }

    if (!grupo.has(key)) {
      grupo.set(key, {
        key,
        totalEmpresa: 0,
        pix: 0,
        espEmpresa: 0,
        recolher: 0,
        repassar: 0,
        qt: 0
      });
    }

    const g = grupo.get(key);
    g.totalEmpresa += emp;
    g.pix += pix;
    g.espEmpresa += espEmpresa;
    g.recolher += recolher;
    g.repassar += repassar;
    g.qt += 1;
  });

  // ==========================
  // ✅ RESUMO TOP
  // ==========================
  outResumo.innerHTML = `
    <div style="background:#0f172a; padding:12px; border-radius:12px; line-height:1.4;">
      <b>📌 Modo:</b> ${__fcModo === "MENSAL" ? "MENSAL" : "DIÁRIO"}<br>
      <b>📅 Período:</b> ${iniEl.value.split("-").reverse().join("/")} até ${fimEl.value.split("-").reverse().join("/")}<br><br>

      <b>🏢 CAIXA DA EMPRESA (sem cliente)</b><br>
      ✅ <b>Total Empresa:</b> ${fmtBRL(totalEmpresa)}<br>
      💳 <b>PIX Empresa:</b> ${fmtBRL(totalPix)}<br>
      💵 <b>Espécie Empresa:</b> ${fmtBRL(totalEspecieEmpresa)}<br><br>

      💰 <b>A recolher (espécie):</b> ${fmtBRL(totalARecolher)}<br>
      💸 <b>A repassar:</b> ${fmtBRL(totalARepassar)}<br><br>

      ✅ <b>Qtd acertos:</b> ${lista.length}
    </div>
  `;

  // ==========================
  // ✅ LISTA (agrupada)
  // ==========================
  const ordenado = [...grupo.values()].sort((a,b)=> a.key.localeCompare(b.key));

  let html = `<div style="display:flex; flex-direction:column; gap:10px;">`;

  ordenado.forEach(g => {
    const titulo =
      (__fcModo === "MENSAL")
        ? `${g.key.split("-")[1]}/${g.key.split("-")[0]}`   // mm/yyyy
        : g.key.split("-").reverse().join("/");            // dd/mm/yyyy

    html += `
      <div style="background:#111827; padding:12px; border-radius:12px;">
        <b>${titulo}</b> — ${g.qt} acerto(s)<br><br>

        🏢 <b>Empresa:</b> ${fmtBRL(g.totalEmpresa)}<br>
        💳 <b>PIX:</b> ${fmtBRL(g.pix)}<br>
        💵 <b>Espécie:</b> ${fmtBRL(g.espEmpresa)}<br><br>

        💰 <b>A recolher:</b> ${fmtBRL(g.recolher)}<br>
        💸 <b>A repassar:</b> ${fmtBRL(g.repassar)}
      </div>
    `;
  });

  html += `</div>`;
  outLista.innerHTML = html;
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

// --- DETALHE: pega GPS e salva direto na máquina (ADMIN) ---
async function atualizarLocalizacaoDetalhe() {
  const numero = (document.getElementById("detNumero")?.value || "").trim().toUpperCase();
  if (!numero) return alert("❌ Selecione o número da máquina.");

  const m = maquinas.find(x => String(x.numero).toUpperCase() === numero);
  if (!m) return alert("❌ Máquina não encontrada.");

  if (!navigator.geolocation) {
    alert("❌ GPS não suportado neste dispositivo/navegador.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      // ✅ salva do jeito que seu sistema usa
      m.lat = lat;
      m.lng = lng;

      const texto = `LAT:${lat.toFixed(6)} | LNG:${lng.toFixed(6)}`;

      const campo = document.getElementById("detEndereco");
      if (campo) campo.value = texto;

      // (opcional) manter também em endereco
      m.endereco = texto;

      salvarNoFirebase();
      alert("✅ Localização atualizada!");
    },
    (err) => {
      alert("❌ Não consegui pegar o GPS. Autorize a localização no navegador.\n\n" + err.message);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

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
  const ul = document.getElementById("listaOcorrencias");
  if (!ul) return;

  ul.innerHTML = "";

  if (!ocorrencias.length) {
    ul.innerHTML = "<li>✅ Nenhuma ocorrência pendente</li>";
    return;
  }

  // mais recentes primeiro
  const ordenadas = [...ocorrencias].sort((a, b) => new Date(b.data) - new Date(a.data));

  ordenadas.forEach((o) => {
    const d = new Date(o.data);
    const li = document.createElement("li");

    // pega a máquina pelo número da ocorrência
    const m = maquinas.find(x =>
      String(x.numero).toUpperCase() === String(o.numero).toUpperCase()
    );

    // lat/lng seguros
    const lat = m ? toNumberCoord(m.lat) : null;
    const lng = m ? toNumberCoord(m.lng) : null;
    const temGPS = (lat !== null && lng !== null);

    // botão localização (✅ agora correto)
    const btnLocal = temGPS
      ? `
        <button type="button"
          style="
            margin-top:10px;
            width:100%;
            padding:14px 12px;
            border:none;
            border-radius:12px;
            background:#38bdf8;
            color:#0b1220;
            font-weight:800;
            font-size:16px;
            line-height:1;
            text-align:center;
          "
          onclick="abrirNoMaps('${lat}', '${lng}')">
          📍 Abrir Localização
        </button>
      `
      : `
        <button type="button"
          style="
            margin-top:10px;
            width:100%;
            padding:14px 12px;
            border:none;
            border-radius:12px;
            background:#38bdf8;
            color:#0b1220;
            font-weight:800;
            font-size:16px;
            line-height:1;
            text-align:center;
          "
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
        style="
          margin-top:10px;
          width:100%;
          padding:14px 12px;
          border:none;
          border-radius:12px;
          background:#22c55e;
          color:#0b1220;
          font-weight:800;
          font-size:16px;
          line-height:1;
          text-align:center;
        "
        onclick="concluirOcorrencia(${o.id})">
        ✅ Concluído
      </button>
    `;

    ul.appendChild(li);
  });
}

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
  const num = (document.getElementById("pubOcNum")?.value || "").trim();
  const estab = document.getElementById("pubOcEstab");

  if (!estab) return;

  if (!num) {
    estab.value = "";
    return;
  }

  // Por enquanto só deixa o campo pronto (sem auto-preencher)
  // Depois a gente liga isso com Firestore pra buscar pelo número.
}

// ✅ MUITO IMPORTANTE (porque seu script é type="module")
window.pubOcAutoPorNumero = pubOcAutoPorNumero;



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
  window.trocarSenhaAdmin = trocarSenhaAdmin;
  if (!exigirAdmin()) return; // ✅ pronto, sem pedir senha

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

  const admin = (usuarios || []).find(u => String(u.tipo || "").toUpperCase() === "ADMIN");
  if (!admin) return alert("❌ Admin não encontrado.");

  admin.senha = novaLimpa;
  salvarNoFirebase();
salvarLoginIndex({ user: admin.user, tipo:"ADMIN", empresaId: admin.empresaId, senha: admin.senha });

  alert("✅ Senha do ADMIN alterada com sucesso!");
}



async function trocarCredenciaisAdmin() {
  window.trocarCredenciaisAdmin = trocarCredenciaisAdmin;

  // ✅ só MASTER deveria trocar credenciais do ADMIN (mais seguro)
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

  // ✅ acha o ADMIN da empresa atual
  const idx = (usuarios || []).findIndex(u =>
    String(u.tipo || "").toUpperCase() === "ADMIN" &&
    String(u.empresaId || "").toUpperCase() === empId
  );

  if (idx === -1) return alert("❌ ADMIN não encontrado nessa empresa.");

  // ⚠️ impede usuário duplicado (mesmo dentro da empresa)
  const duplicado = (usuarios || []).some((u, i) =>
    i !== idx &&
    String(u.user || "").toLowerCase() === userLimpo
  );
  if (duplicado) return alert("❌ Já existe outro usuário com esse login.");

  // ✅ atualiza no array local e no doc da empresa
  usuarios[idx].nome = nomeLimpo;
  usuarios[idx].user = userLimpo;
  usuarios[idx].senha = senhaLimpa;

  await salvarNoFirebase(true);

  // ✅ atualiza também o índice central (login)
  await salvarLoginIndex({
    user: userLimpo,
    tipo: "ADMIN",
    empresaId: empId,
    senha: senhaLimpa
  });

  alert("✅ Credenciais do ADMIN atualizadas (Nome/Usuário/Senha) e salvas no banco!");
}


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

  // se já existe, não recria
  if (snap.exists()) {
    // mas garante que o índice central tenha os logins
    try { await repararIndiceLoginsDaEmpresa(emp); } catch {}
    return;
  }

  const usuariosBase = [
    // MASTER
    {
      id: Date.now(),
      tipo: "MASTER",
      nome: "MASTER",
      user: "strondamusic",
      senha: "stronda musicmusic",
      empresaId: EMPRESA_PRINCIPAL // "EMPRESA_PRINCIPAL_ID"

    },
    // ADMIN da empresa
    {
      id: Date.now() + 1,
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

  // 2) grava os logins no índice central
  for (const u of usuariosBase) {
    await salvarLoginIndex({
      user: u.user,
      tipo: u.tipo,
      empresaId: u.empresaId,
      senha: u.senha
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

  // grava TODOS os usuários no índice central
  for (const u of lista) {
    if (!u?.user || !u?.senha || !u?.tipo) continue;

    await salvarLoginIndex({
      user: u.user,
      tipo: u.tipo,
      empresaId: u.empresaId || empId,
      senha: u.senha
    });
  }
}

function aplicarClassePermissaoBody() {
  document.body.classList.remove("is-admin", "is-master", "is-colab");

  if (!sessaoUsuario) {
    return; // sem login = nada
  }

  const t = String(sessaoUsuario.tipo || "").toUpperCase();

  if (t === "MASTER") {
    document.body.classList.add("is-master", "is-admin");
    return;
  }

  if (t === "ADMIN") {
    document.body.classList.add("is-admin");
    return;
  }

  document.body.classList.add("is-colab");
}



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

    const idxEmp = lista.findIndex(e => String(e.id||"").toUpperCase() === data.empId);

    if (idxEmp === -1) {
      lista.push({ id: data.empId, nome: data.nomeEmpresa }); // ✅ nome real
    } else {
      // ✅ atualiza nome se mudou
      lista[idxEmp].nome = data.nomeEmpresa;
    }

    await salvarListaEmpresas(lista);


    // 2) cria estrutura base se precisar
    await criarEstruturaEmpresaSeNaoExistir(data.empId);

    // 3) aplica dados do pré-cadastro
    const refEmpresaApp = doc(db, "empresas", data.empId, "dados", "app");

    const snap = await getDoc(refEmpresaApp);
    const cur = snap.data() || {};
    const usuariosCur = Array.isArray(cur.usuarios) ? cur.usuarios : [];

    // garante MASTER
    const temMaster = usuariosCur.some(u => String(u.tipo || "").toUpperCase() === "MASTER");
    if (!temMaster) {
      usuariosCur.push({
        id: Date.now(),
        tipo: "MASTER",
        nome: "MASTER",
        user: "strondamusic",
        senha: "strondamusic",
        empresaId: EMPRESA_PRINCIPAL

      });
    }

    // garante/atualiza ADMIN da empresa
    const idx = usuariosCur.findIndex(u =>
      String(u.tipo || "").toUpperCase() === "ADMIN" &&
      String(u.empresaId || "").toUpperCase() === data.empId
    );

    if (idx >= 0) {
      usuariosCur[idx].nome = data.adminNome.toUpperCase();
      usuariosCur[idx].user = data.adminUser;
      usuariosCur[idx].senha = data.adminSenha;
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


    window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btnCadastrarEmpresa");
  if (!btn) {
    console.warn("❌ Não achei #btnCadastrarEmpresa no HTML");
    return;
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    console.log("🔥 Clique detectado no botão cadastrar empresa");
    preCadastrarEmpresa();
  });
});


    // ✅ salva/atualiza no índice central

await salvarLoginIndex({ user: data.adminUser, tipo: "ADMIN", empresaId: data.empId, senha: data.adminSenha });


    // 4) seleciona e atualiza UI
    await selecionarEmpresa(data.empId);
    await listarEmpresasUI();

    alert("✅ Empresa cadastrada com sucesso!");

    // 5) limpa campos
    ["pcEmpId","pcNomeEmpresa","pcDoc","pcAdminNome","pcAdminUser","pcAdminSenha"].forEach(id=>{
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
    li.appendChild(btnDel);
    ul.appendChild(li);
  });
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

async function salvarLoginIndex({ user, tipo, empresaId, senha }) {
  user = String(user || "").trim().toLowerCase();
  if (!user) return;

  await setDoc(loginsRef(), {
    atualizadoEm: new Date().toISOString(),
    usuarios: {
      [user]: {
        tipo: String(tipo || "").toUpperCase(),
        empresaId: String(empresaId || "").toUpperCase(),
        senha: String(senha || "")
      }
    }
  }, { merge: true });
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



  // ✅ tem que carregar usuários antes de validar sessão
  await carregarDadosUmaVezParaLogin();

  if (validarSessaoPersistida()) {
    mostrarApp();
    aplicarClassePermissaoBody();
    aplicarPermissoesMenu();
    aplicarPermissoesUI();

    pararSnapshotAtual();
    __syncAtivo = false;
    await iniciarSincronizacaoFirebase();

    try { listarMaquinas(); } catch {}
    try { atualizarStatus(); } catch {}
    try { listarOcorrencias(); } catch {}
    try { atualizarAlertaOcorrencias(); } catch {}
  } else {
    mostrarTelaLogin();
    aplicarClassePermissaoBody();
    limparCamposLogin();
  }

  carregarEmpresasPublicasFirestore();
  ligarEventosOcorrenciaPublica();



function validarSessaoPersistida() {
  if (!sessaoUsuario) return false;

  const user = String(sessaoUsuario.user || "").toLowerCase();
  const tipo = String(sessaoUsuario.tipo || "").toUpperCase();
  const empAtual  = String(empresaAtualId || "").toUpperCase();

  if (!user || !tipo) return false;

  // ✅ expira sessão em 12h (aqui pode limpar mesmo)
  const criadoEm = Number(sessaoUsuario.criadoEm || 0);
  if (criadoEm && (Date.now() - criadoEm) > (12 * 60 * 60 * 1000)) {
    limparSessao();  // ✅ aqui pode
    return false;
  }

  // ✅ acha usuário real NA EMPRESA ATUAL
  const u = (usuarios || []).find(x =>
    String(x.user || "").toLowerCase() === user &&
    String(x.tipo || "").toUpperCase() === tipo
  );

  // ❌ se não achou usuário nessa empresa, só invalida pra essa empresa
  if (!u) return false;

  // ✅ MASTER vale em qualquer empresa
  if (tipo === "MASTER") return true;

  // ✅ ADMIN/COLAB: só vale se for a empresa atual
  const empUser = String(u.empresaId || "").toUpperCase();
  if (!empUser || empUser !== empAtual) return false;

  return true;
}


window.adicionarEmpresa = adicionarEmpresa;
window.voltar = voltar;


// ===============================
// ✅ OCULTAR "CADASTRO/CADASTRAR MÁQUINA" PARA COLAB (GLOBAL + ANTI-REAPARECER)
// ===============================

function ocultarCadastroMaquinaParaColab() {
  if (isAdmin()) return; // ADMIN/MASTER vê

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



function ligarUIFechamentoCaixa() {
  const ini = document.getElementById("fcIni");
  const fim = document.getElementById("fcFim");
  const bDia = document.getElementById("btnFCDiario");
  const bMes = document.getElementById("btnFCMensal");
  const bGerar = document.getElementById("btnFCGerar");

  if (!ini || !fim || !bDia || !bMes || !bGerar) return;

  ini.addEventListener("change", renderFechamentoCaixa);
  fim.addEventListener("change", renderFechamentoCaixa);

  bDia.addEventListener("click", () => fcSetModo("DIARIO"));
  bMes.addEventListener("click", () => fcSetModo("MENSAL"));

  bGerar.addEventListener("click", renderFechamentoCaixa);
}



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



window.preCadastrarEmpresa = async function () {
  const btn = document.getElementById("btnCadastrarEmpresa");
  if (btn) btn.disabled = true;

  try {
    const empresaId = document.getElementById("pcEmpId").value.trim().toUpperCase();
    const nomeEmpresa = document.getElementById("pcNomeEmpresa").value.trim();
    const docCpfCnpj = document.getElementById("pcDoc").value.trim();
    const adminNome = document.getElementById("pcAdminNome").value.trim();
    const adminUser = document.getElementById("pcAdminUser").value.trim();
    const adminSenha = document.getElementById("pcAdminSenha").value.trim();
    const diaPagamento = Number(document.getElementById("pcDiaPagamento").value);

    // validações
    if (!empresaId) throw new Error("Preencha o Empresa ID.");
    if (!nomeEmpresa) throw new Error("Preencha o Nome da empresa.");
    if (!adminNome) throw new Error("Preencha o Nome do ADMIN.");
    if (!adminUser) throw new Error("Preencha o Usuário do ADMIN.");
    if (!adminSenha || adminSenha.length < 4) throw new Error("Senha do ADMIN precisa ter no mínimo 4 caracteres.");
    if (!Number.isInteger(diaPagamento) || diaPagamento < 1 || diaPagamento > 28) {
      throw new Error("Dia de pagamento deve ser entre 1 e 28.");
    }

    // salva no Firestore
    await setDoc(doc(db, "empresas", empresaId), {
      empresaId,
      nomeEmpresa,
      docCpfCnpj: docCpfCnpj || null,
      diaPagamento,
      admin: {
        nome: adminNome,
        usuario: adminUser,
        senha: adminSenha // ⚠️ só pra teste; ideal é usar Firebase Auth
      },
      criadoEm: serverTimestamp()
    }, { merge: true });

    alert("✅ Empresa cadastrada com sucesso!");

    // limpa campos
    document.getElementById("pcEmpId").value = "";
    document.getElementById("pcNomeEmpresa").value = "";
    document.getElementById("pcDoc").value = "";
    document.getElementById("pcAdminNome").value = "";
    document.getElementById("pcAdminUser").value = "";
    document.getElementById("pcAdminSenha").value = "";
    document.getElementById("pcDiaPagamento").value = 5;

  } catch (err) {
    console.error("❌ ERRO ao cadastrar empresa:", err);
    alert(err?.message || "Erro ao cadastrar empresa. Veja o console (F12).");
  } finally {
    if (btn) btn.disabled = false;
  }
};



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

async function main() {
  console.count("✅ main() chamado");
  console.trace("📌 quem chamou main()");
  // 1) Firebase config
  const firebaseConfig = {
    
    apiKey: "AIzaSyDwKkCtERVgvOsmEH1X_T1gqn66bDRHsYo",
    authDomain: "stronda-music-controle.firebaseapp.com",
    projectId: "stronda-music-controle",
    storageBucket: "stronda-music-controle.firebasestorage.app",
    messagingSenderId: "339385914034",
    appId: "1:339385914034:web:601d747b7151d507ad6fab"
  };

  // ✅ Inicialização segura (não duplica app)
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

  console.log("Firebase apps:", getApps().length);
  console.log("apiKey em uso:", app.options.apiKey);
  console.log("config completo:", app.options);

  // services
  const db = getFirestore(app);
  const auth = getAuth(app);

  // ✅ se você quer usar no console
  window.__db = db;

  // =====================
  // ✅ EMPRESA PRINCIPAL
  // =====================
  const EMPRESA_PRINCIPAL_ID   = "STRONDA-MUSIC";  // ID do Firestore
  const EMPRESA_PRINCIPAL_NOME = "STRONDA MUSIC";  // Nome pra exibir
  const EMPRESA_PRINCIPAL      = EMPRESA_PRINCIPAL_ID;

  // ✅ A PARTIR DAQUI: cola o resto do seu código
  // ⚠️ Só troca: onde você usava db/auth globais, agora eles existem aqui dentro.
  // Se o seu código depende de db/auth em outras funções fora do main,
  // você pode fazer:
  window.db = db;
  window.auth = auth;

  // ... (cole seu resto aqui)
}

// ✅ BOOT ÚNICO (não duplica, não briga)
document.addEventListener("DOMContentLoaded", async () => {
  try {
    console.log("🚀 BOOT ÚNICO: start");

    // 1) define empresa atual cedo
    const emp = localStorage.getItem("empresaAtualId") || EMPRESA_PRINCIPAL_ID;
    setEmpresaAtual(emp);

    // 2) mostra tela de login inicialmente (evita tela travada)
    try { mostrarTelaLogin(); } catch {}

    // 3) garante Firebase + auth + dados mínimos (isso que destrava o app)
    await iniciarSincronizacaoFirebase();

    // 4) atualiza nome da empresa no topo (se existir)
    try { await atualizarNomeEmpresaNaTela?.(); } catch {}

    // 5) carrega empresas no select público e liga eventos (se existir)
    try { await carregarEmpresasPublicasFirestore?.(); } catch {}
    try { ligarEventosOcorrenciaPublica?.(); } catch {}

    // 6) se tiver sessão válida, entra no app
    try {
      if (typeof validarSessaoPersistida === "function" && validarSessaoPersistida()) {
        mostrarApp();
        aplicarClassePermissaoBody?.();
        aplicarPermissoesMenu?.();
        aplicarPermissoesUI?.();

        try { listarMaquinas?.(); } catch {}
        try { atualizarStatus?.(); } catch {}
        try { listarOcorrencias?.(); } catch {}
        try { atualizarAlertaOcorrencias?.(); } catch {}
      } else {
        // sem sessão -> fica no login e garante botão OK
        habilitarBotaoLogin?.();
      }
    } catch (e) {
      console.warn("⚠️ sessão/permissões falhou:", e);
      habilitarBotaoLogin?.();
    }

    console.log("✅ BOOT ÚNICO: pronto");
  } catch (e) {
    console.error("❌ BOOT ÚNICO falhou:", e);
    // fallback: não deixa travar
    try { habilitarBotaoLogin(); } catch {}
  }
});



window.entrarLogin = (tipo) => entrarLogin(tipo);


