// =====================
// 🔥 FIREBASE (Firestore) - SINCRONIZAR PC + CELULAR
// =====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  deleteDoc,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

  

let __preloadAt = 0;
let __preloadEmpresa = "";
const __preloadCooldownMs = 30000; // 30s
let __retryQuotaTimer = null;
let __firestoreBloqueado = false;
let __avisouQuotaOffline = false;

function isQuotaErr(err) {
  const code = String(err?.code || "");
  const msg  = String(err?.message || "");
  return code.includes("resource-exhausted") || /quota/i.test(msg);
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

  console.warn("Firestore em modo offline por quota:", err);

  // ✅ tenta religar depois de 10 minutos (somente quando entrou em quota)
  clearTimeout(__retryQuotaTimer);
  __retryQuotaTimer = setTimeout(() => {
  __firestoreBloqueado = false;
  __avisouQuotaOffline = false;
  iniciarSincronizacaoFirebase();
}, 60 * 60 * 1000); // ✅ 1 hora

}


// ✅ COLOQUE AQUI SEU firebaseConfig do Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyDwKkCtERVgvOsmEH1X_T1gqn66bDRHsYo",
  authDomain: "stronda-music-controle.firebaseapp.com",
  projectId: "stronda-music-controle",
  storageBucket: "stronda-music-controle.firebasestorage.app",
  messagingSenderId: "339385914034",
  appId: "1:339385914034:web:601d747b7151d507ad6fab"
};


const appFirebase = initializeApp(firebaseConfig);
const db = getFirestore(appFirebase);
const auth = getAuth(appFirebase);






// ✅ UM ÚNICO DOC COM TODOS OS DADOS (mais simples)
let empresaAtualId = null;
let docRef = null;
let unsubSnapshot = null;

let __authPromise = null;
let __syncAtivo = false;     // indica que snapshot está ligado
let __syncIniciando = false; // evita iniciar duas vezes ao mesmo tempo

async function ensureAuth() {
  if (__authPromise) return __authPromise;
  __authPromise = signInAnonymously(auth).catch((e) => {
    __authPromise = null;
    throw e;
  });
  return __authPromise;
}




function setEmpresaAtual(empresaId){
  empresaAtualId = String(empresaId || "").trim().toUpperCase();

  // ✅ salva a empresa escolhida (pra não sumir quando abrir de novo)
  localStorage.setItem("empresaAtualId", empresaAtualId);

  // ✅ caminho do Firestore
  docRef = doc(db, "empresas", empresaAtualId, "dados", "app");
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


// =====================
// ✅ BACKUP LOCAL (anti-perda)
// =====================
function keyBackupEmpresa() {
  const emp = String(empresaAtualId || "STRONDA").toUpperCase();
  return "BACKUP_EMPRESA_" + emp;
}

// ====== OCORRÊNCIA PÚBLICA (TELA LOGIN) ======
const pubEmpresa = document.getElementById("pubOcEmpresa");
const pubNum = document.getElementById("pubOcNum");
const pubEstab = document.getElementById("pubOcEstab");

async function buscarEstabPorEmpresaENumero(empId, num) {
  empId = String(empId || "").trim().toUpperCase();
  num = String(num || "").trim().toUpperCase();
  if (!empId || !num) return "";

  try {
    // ✅ CACHE: 1 leitura por minuto por empresa (em vez de toda digitação)
    const cached = __cacheEmpresaData.get(empId);
    if (cached && (Date.now() - cached.at) < __cacheTTLms) {
      const maquinasEmp = Array.isArray(cached.data.maquinas) ? cached.data.maquinas : [];
      const m = maquinasEmp.find(x => String(x.numero || "").trim().toUpperCase() === num);
      return m ? String(m.estab || "").trim().toUpperCase() : "";
    }

    const ref = doc(db, "empresas", empId, "dados", "app");
    const snap = await getDoc(ref);
    if (!snap.exists()) return "";

    const data = snap.data() || {};
    __cacheEmpresaData.set(empId, { data, at: Date.now() });

    const maquinasEmp = Array.isArray(data.maquinas) ? data.maquinas : [];
    const m = maquinasEmp.find(x => String(x.numero || "").trim().toUpperCase() === num);
    return m ? String(m.estab || "").trim().toUpperCase() : "";
  } catch (e) {
    console.error("buscarEstabPorEmpresaENumero erro:", e);
    return "";
  }
}

async function carregarDadosUmaVezParaLogin() {
  try {
    await ensureAuth();
    if (!docRef) throw new Error("docRef está null. Chame setEmpresaAtual() antes.");

    const emp = String(empresaAtualId || "").toUpperCase();
    const now = Date.now();

    // ✅ evita spam de leitura no login
    if (__preloadEmpresa === emp && (now - __preloadAt) < __preloadCooldownMs) {
      firebasePronto = true;
      habilitarBotaoLogin();
      return;
    }
    __preloadEmpresa = emp;
    __preloadAt = now;

    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        atualizadoEm: new Date().toISOString(),
        ocorrencias: [],
        maquinas: [],
        acertos: [],
        usuarios: []
      });
    }

    const snap2 = snap.exists() ? snap : await getDoc(docRef);
    const data = snap2.exists() ? (snap2.data() || {}) : {};

    if (Array.isArray(data.ocorrencias)) ocorrencias = data.ocorrencias;
    if (Array.isArray(data.maquinas))    maquinas    = data.maquinas.map(normalizarGPSMaquina);
    if (Array.isArray(data.acertos))     acertos     = data.acertos;
    if (Array.isArray(data.usuarios))    usuarios    = data.usuarios;

    salvarBackupLocal();

    firebasePronto = true;
    habilitarBotaoLogin();
  } catch (e) {
    console.error("carregarDadosUmaVezParaLogin erro:", e);

    // se quota estourou, entra offline
    if (isQuotaErr(e)) {
      entrarModoOfflinePorQuota(e);
      return;
    }

    const ok = carregarBackupLocal();
    firebasePronto = true;
    habilitarBotaoLogin();

    if (!ok) {
      alert("❌ Não consegui carregar dados do Firebase e não achei backup local.\n\n" + (e?.message || e));
    } else {
      alert("⚠️ Firebase falhou. Carreguei seus dados do backup local.\n\n" + (e?.message || e));
      try { listarMaquinas(); } catch {}
      try { atualizarStatus(); } catch {}
      try { listarOcorrencias(); } catch {}
    }
  }
}




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

  const nome = prompt("Nome/ID da empresa (ex: STRONDA, EMPRESA2, etc):");
  if (!nome) return;

  const empresaId = String(nome).trim().toUpperCase();

  const hid = document.getElementById("empresaIdAtual");
  if (hid) hid.value = empresaId;

  pararSnapshotAtual(); // ✅ AQUI

  setEmpresaAtual(empresaId);

  firebasePronto = false;
  desabilitarBotaoLogin();
  iniciarSincronizacaoFirebase();

  alert("✅ Empresa selecionada: " + empresaId);
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
let __rotinaRodouPorEmpresa = {}; // { "STRONDA": true, ... }

function rodarRotinasApenasUmaVezPorEmpresa() {
  const emp = String(empresaAtualId || "STRONDA").toUpperCase();

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




 

async function iniciarSincronizacaoFirebase() {
  if (__firestoreBloqueado) return;

  // garante docRef
  if (!docRef) {
    const emp = localStorage.getItem("empresaAtualId") || "STRONDA";
    setEmpresaAtual(emp);
  }

  // se não está logado, só carrega uma vez pro login (sem snapshot)
  if (!sessaoUsuario) {
    await carregarDadosUmaVezParaLogin();
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




  function salvarSessao(u) {
  sessaoUsuario = { tipo: u.tipo, nome: u.nome, user: u.user, empresaId: u.empresaId || null };
  localStorage.setItem("sessaoUsuario", JSON.stringify(sessaoUsuario));

  window.__sessao = sessaoUsuario; // ✅ pra enxergar no console
}

function carregarSessao() {
  try {
    const s = JSON.parse(localStorage.getItem("sessaoUsuario") || "null");
    sessaoUsuario = s;
  } catch {
    sessaoUsuario = null;
  }
}





function isAdmin() {
  const t = String(sessaoUsuario?.tipo || "").toUpperCase();
  return t === "ADMIN" || t === "MASTER";
}

function isMaster() {
  const t = String(sessaoUsuario?.tipo || "").toUpperCase();
  return t === "MASTER";
}


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
window.mostrarApp = mostrarApp;


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

function newId() {
  return (crypto?.randomUUID?.() || (Date.now() + "_" + Math.random().toString(16).slice(2)));
}

async function migrarLocalStorageParaFirebaseSePreciso() {
  try {
    const emp = String(empresaAtualId || "STRONDA").toUpperCase();
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



function aplicarPermissoesMenu() {
  const btnSel = document.getElementById("btnSelecionarEmpresa");
  if (!btnSel) return; // se não achou o botão, não faz nada
  btnSel.style.display = isMaster() ? "block" : "none";
}




function entrarLogin(tipo) {
  if (!firebasePronto) {
    return alert("⏳ Carregando do Firebase... aguarde 2 segundos e tente novamente.");
  }

  tipo = String(tipo || "").toUpperCase();
  if (tipo.includes("ADMIN")) tipo = "ADMIN";
  if (tipo.includes("COLAB")) tipo = "COLAB";

  
  const user = (document.getElementById("loginUser")?.value || "").trim().toLowerCase();
  const senha = (document.getElementById("loginSenha")?.value || "").trim();

  if (!user || !senha) return alert("❌ Preencha usuário e senha.");

  // 1) pega todos que batem user/senha + tipo
const candidatos = (usuarios || []).filter(x => {
  const t = String(x.tipo || "").toUpperCase();

  const okTipo = (tipo === "ADMIN")
    ? (t === "ADMIN" || t === "MASTER")
    : (t === "COLAB");

  const okLogin =
    okTipo &&
    String(x.user || "").toLowerCase() === user &&
    String(x.senha || "") === senha;

  if (!okLogin) return false;

  // se for ADMIN normal, só entra na empresa atual
  if (t === "ADMIN") {
    const empUser = String(x.empresaId || "").toUpperCase();
    const empAtual = String(empresaAtualId || "").toUpperCase();
    return empUser === empAtual;
  }

  return true;
});

// 2) ✅ prioridade: MASTER primeiro
const u =
  candidatos.find(x => String(x.tipo || "").toUpperCase() === "MASTER") ||
  candidatos[0];




  if (!u) return alert("❌ Login inválido.");

  salvarSessao(u);

  pararSnapshotAtual();
__syncAtivo = false;
iniciarSincronizacaoFirebase(); // agora vai ligar snapshot porque sessaoUsuario existe


    if (u.tipo === "COLAB") {
    alert("✅ Entrou na empresa: " + (u.empresaId || "SEM EMPRESA"));
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
    foneFormatado: formatarTelefoneBR(fone),
    lat,
    lng,
    resetStatusAt: null,
  });

  cadastroGeoTemp = null;

  

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

  if (tituloMaquina) tituloMaquina.textContent = `🔧 ${m.estab} (JB Nº ${m.numero})`;

  if (detNumero)  detNumero.value  = String(m.numero || "");
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
  
function salvarAlteracoesMaquina() {
  if (!exigirAdmin()) return;

  const m = maquinas.find(x => x.numero == maquinaSelecionadaNumero);
  if (!m) return alert("Máquina não encontrada");

  // ✅ pega os inputs aqui dentro (escopo correto)
  const detEstab = document.getElementById("detEstab");
  const detCliente = document.getElementById("detCliente");
  const detEndereco = document.getElementById("detEndereco");
  const detStatus = document.getElementById("detStatus");
  const detFone = document.getElementById("detFone");

  const estabAntigo   = (m.estab || "").toUpperCase().trim();
  const clienteAntigo = (m.cliente || "").toUpperCase().trim();

  const estabNovo    = (detEstab?.value || "").trim().toUpperCase();
  const clienteNovo  = (detCliente?.value || "").trim().toUpperCase();
  const enderecoNovo = (detEndereco?.value || "").trim().toUpperCase();
  const statusNovo   = (detStatus?.value || "ALUGADA");

  if (!estabNovo) return alert("❌ O estabelecimento não pode ficar vazio");

  const duplicado = maquinas.some(x =>
    x.numero != m.numero && String(x.estab || "").toUpperCase().trim() === estabNovo
  );
  if (duplicado) return alert("⚠️ Já existe uma máquina com esse estabelecimento");

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




// Função para fazer login
function fazerLogin() {
  const tipo = document.getElementById("tipoLogin")?.value || "ADMIN";
  // usa o login certo (Firebase)
  entrarLogin(tipo);
}
window.fazerLogin = fazerLogin;



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

  alert("✅ Senha do ADMIN alterada com sucesso!");
}


async function trocarCredenciaisAdmin() {
  window.trocarCredenciaisAdmin = trocarCredenciaisAdmin;
  if (!exigirAdmin()) return; // ✅ sem pedir senha extra

  const novoUser = prompt("Digite o NOVO usuário do ADMIN (ex: admin2):");
  if (novoUser === null) return;

  const novoUserLimpo = String(novoUser).trim().toLowerCase();
  if (!novoUserLimpo) return alert("❌ Usuário não pode ficar vazio.");

  const novaSenha = prompt("Digite a NOVA senha do ADMIN (mínimo 4 caracteres):");
  if (novaSenha === null) return;

  const novaSenhaLimpa = String(novaSenha).trim();
  if (novaSenhaLimpa.length < 4) return alert("❌ Senha muito curta.");

  const confirma = prompt("Confirme a NOVA senha do ADMIN:");
  if (confirma === null) return;

  if (String(confirma).trim() !== novaSenhaLimpa) {
    alert("❌ Confirmação não bate.");
    return;
  }

  const admin = (usuarios || []).find(u => String(u.tipo || "").toUpperCase() === "ADMIN");
  if (!admin) return alert("❌ Admin não encontrado.");

  admin.user = novoUserLimpo;
  admin.senha = novaSenhaLimpa;

  salvarNoFirebase();

  alert("✅ Usuário e senha do ADMIN alterados!");
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

window.toggleSenha = toggleSenha;


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
  sessaoUsuario = null;
  localStorage.removeItem("sessaoUsuario");
  window.__sessao = null; // ✅
  mostrarTelaLogin();
}


// =====================
// 🏢 EMPRESAS (LISTA CENTRAL)
// =====================
const EMPRESA_PRINCIPAL = "STRONDA";

async function criarEstruturaEmpresaSeNaoExistir(emp) {
  emp = String(emp || "").trim().toUpperCase();
  if (!emp) return;

  const ref = doc(db, "empresas", emp, "dados", "app");
  const snap = await getDoc(ref);

  if (snap.exists()) return; // já existe, não mexe

  const usuariosBase = [
    // ✅ MASTER (você) — pra conseguir entrar em qualquer empresa
    {
      id: Date.now(),
      tipo: "MASTER",
      nome: "MASTER",
      user: "strondamusic",
      senha: "strondamusic",
      empresaId: "MASTER"
    },

    // ✅ ADMIN automático da empresa
    {
      id: Date.now() + 1,
      tipo: "ADMIN",
      nome: "ADMIN",
      user: `admin_${emp.toLowerCase()}`, // ex: admin_empresa2
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

    // ✅ PERFIL DA EMPRESA
    empresaPerfil: {
      nomeEmpresa: emp,          // se ainda não tem campo, usa o ID
      adminNome: "ADMIN",        // depois você preenche no pré-cadastro
      criadoEm: new Date().toISOString(),
      // docTipo/docNumero só entra se você tiver no pré-cadastro
    },

    // ✅ PAGAMENTO / BLOQUEIO
    billing: {
      diaPagamento: 5,
      ultimoPagamentoEm: new Date().toISOString(),
      bloqueado: false,
      bloqueadoEm: null,
      motivo: ""
    }
  };

  await setDoc(ref, payload);


  console.log("✅ Empresa criada no Firestore:", emp);
}

async function selecionarEmpresa(emp) {
  emp = String(emp || "").trim().toUpperCase();
  if (!emp) return;

  pararSnapshotAtual(); // ✅ PARA snapshot antes de trocar

  setEmpresaAtual(emp);
  localStorage.setItem("empresaAtualId", emp);

  firebasePronto = false;
  desabilitarBotaoLogin();

  await iniciarSincronizacaoFirebase();

  if (isLogado()) {
    mostrarApp();
    aplicarPermissoesUI();
    aplicarPermissoesMenu();
  } else {
    mostrarTelaLogin();
  }
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
    let lista = await garantirListaEmpresas();
    if (!lista.includes(data.empId)) {
      lista.push(data.empId);
      await salvarListaEmpresas(lista);
    }

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
        empresaId: "MASTER"
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
    await setDoc(ref, {
      atualizadoEm: new Date().toISOString(),
      empresas: [EMPRESA_PRINCIPAL]
    });
    return [EMPRESA_PRINCIPAL];
  }

  const data = snap.data() || {};
  let lista = Array.isArray(data.empresas) ? data.empresas : [];
  lista = lista.map(e => String(e || "").trim().toUpperCase()).filter(Boolean);

  if (!lista.includes(EMPRESA_PRINCIPAL)) {
    lista.unshift(EMPRESA_PRINCIPAL);
    await setDoc(ref, { empresas: lista, atualizadoEm: new Date().toISOString() }, { merge: true });
  }

  return lista;
}

async function salvarListaEmpresas(lista) {
  const ref = empresasConfigRef();
  await setDoc(ref, { empresas: lista, atualizadoEm: new Date().toISOString() }, { merge: true });
}

async function listarEmpresasUI() {
  if (!exigirMaster()) return;

  const ul = document.getElementById("listaEmpresas");
  if (!ul) return;

  let lista = await garantirListaEmpresas();

  // ✅ REMOVE A PRINCIPAL DA TELA (mas continua existindo no Firestore)
  lista = lista.filter(emp => emp !== EMPRESA_PRINCIPAL);

  ul.innerHTML = "";

  if (!lista.length) {
    ul.innerHTML = "<li style='opacity:.85;'>Nenhuma empresa cadastrada ainda.</li>";
    return;
  }

  lista.forEach((emp) => {
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
    btnSel.textContent = `✅ Selecionar ${emp}`;
    btnSel.style.flex = "1";
    btnSel.onclick = () => selecionarEmpresa(emp);

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.textContent = "🗑";
    btnDel.style.width = "60px";

    btnDel.onclick = async () => {

      pararSnapshotAtual();
  try {
    if (!confirm(`Apagar a empresa ${emp}?`)) return;

    // ✅ tira da tela na hora (UX + evita recarregar lista)
    li.remove();

    // 1) remove da lista central (1 write)
    const nova = (await garantirListaEmpresas()).filter(x => x !== emp);
    await salvarListaEmpresas(nova);

    // 2) apaga o doc principal da empresa (1 write)
    await deleteDoc(doc(db, "empresas", emp, "dados", "app"));

    alert("✅ Empresa apagada!");
  } catch (e) {
    console.error(e);

    // se deu erro, recarrega lista pra não ficar UI “mentindo”
    try { await listarEmpresasUI(); } catch {}

    // ✅ mensagem certa pra quota
    if (String(e?.code || "").includes("resource-exhausted") || /quota/i.test(String(e?.message||""))) {
      alert("❌ Firestore estourou a quota agora. Reduza leituras/gravações (vou te mostrar abaixo e o que mudar).");
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


async function adicionarEmpresa() {
  if (!exigirMaster()) return;

  const inp = document.getElementById("empresaNova");
  const nome = String(inp?.value || "").trim().toUpperCase();

  if (!nome) return alert("❌ Digite um nome de empresa.");
  if (nome === EMPRESA_PRINCIPAL) return alert("⚠️ STRONDA já é a principal.");

  let lista = await garantirListaEmpresas();
  if (lista.includes(nome)) return alert("⚠️ Empresa já existe.");

  lista.push(nome);
  await salvarListaEmpresas(lista);

  // ✅ cria /empresas/NOME/dados/app com MASTER + ADMIN automático
  await criarEstruturaEmpresaSeNaoExistir(nome);

  if (inp) inp.value = "";
  await listarEmpresasUI();
  alert("✅ Empresa adicionada!");
}

async function carregarEmpresasPublicasFirestore() {
  const sel = document.getElementById("pubOcEmpresa");
  if (!sel) return;

  try {
    let lista = await garantirListaEmpresas();
    lista = (lista || []).map(e => String(e || "").trim().toUpperCase()).filter(Boolean);

    sel.innerHTML = `<option value="">Selecione...</option>`;

    // ✅ SEM getDoc por empresa (economiza MUITO)
    for (const empId of lista) {
      sel.innerHTML += `<option value="${empId}">${empId}</option>`;
    }

    const numEl = document.getElementById("pubOcNum");
    if (numEl) numEl.disabled = !sel.value;

  } catch (e) {
    console.error("❌ erro carregar empresas públicas:", e);
    sel.innerHTML = `<option value="">Selecione...</option><option value="STRONDA">STRONDA</option>`;
  }
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

async function setNomeEmpresa(empId, nomeBonito) {
  empId = String(empId || "").trim().toUpperCase();
  nomeBonito = String(nomeBonito || "").trim();

  const ref = doc(db, "empresas", empId, "dados", "app");

  await setDoc(ref, {
    empresaPerfil: { nomeEmpresa: nomeBonito }
  }, { merge: true });

  console.log("✅ Nome atualizado:", empId, "->", nomeBonito);

  // recarrega o select público
  try { carregarEmpresasPublicasFirestore(); } catch {}
}

// expõe pro console (porque é module)
window.setNomeEmpresa = setNomeEmpresa;



// =====================
// ✅ EXPOR FUNÇÕES PRO HTML (porque script.js é type="module")
// =====================
Object.assign(window, {
  exportarDados,
  importarDadosArquivo,
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



window.fazerLogin = fazerLogin;
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

let __visReconnAt = 0;

window.addEventListener("load", () => {
  carregarSessao();

  setEmpresaAtual(localStorage.getItem("empresaAtualId") || EMPRESA_PRINCIPAL);
  carregarDadosUmaVezParaLogin();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pararSnapshotAtual();
      return;
    }

    if (__firestoreBloqueado) return;

    const now = Date.now();
    if (now - __visReconnAt < 3000) return; // ✅ 3s de trava
    __visReconnAt = now;

    iniciarSincronizacaoFirebase();
  });

  // ✅ mantém o resto que você já tinha aqui embaixo:
  if (sessaoUsuario) {
    mostrarApp();
    aplicarPermissoesUI();
    aplicarPermissoesMenu();
  } else {
    mostrarTelaLogin();
    limparCamposLogin();
  }

  carregarEmpresasPublicasFirestore();
  ligarEventosOcorrenciaPublica();
});


// deixa as funções visíveis pro onclick do HTML (porque seu script é type="module")
window.preCadastrarEmpresa = preCadastrarEmpresa;
window.adicionarEmpresa = adicionarEmpresa;
window.voltar = voltar;

