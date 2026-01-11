// =====================
// 🔥 FIREBASE (Firestore) - SINCRONIZAR PC + CELULAR
// =====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";



import {
  getAuth as fbGetAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";



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
const auth = fbGetAuth(appFirebase);





// ✅ UM ÚNICO DOC COM TODOS OS DADOS (mais simples)
const docRef = doc(db, "stronda", "dados");

async function garantirDocExiste() {
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
}


// estado do app (vai substituir localStorage)
let ocorrencias = [];
let maquinas = [];
let acertos = [];
let usuarios = [];
let sessaoUsuario = null;
let firebasePronto = false;


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


// =====================
// ✅ STATUS DE ACERTOS
// =====================
function atualizarStatus() {
  const listaStatus = document.getElementById("listaStatus");
  if (!listaStatus) return;

  listaStatus.innerHTML = "";

  // se ainda não carregou do Firebase
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
    li.style.cursor = "pointer";
    li.textContent = `${teveAcerto ? "🟢" : "🔴"} ${estabKey} (JB Nº ${String(m.numero || "").toUpperCase()})`;

    // abre detalhes do mês
    li.onclick = () => {
      if (typeof abrirDetalhesCliente === "function") abrirDetalhesCliente(m.estab);
    };

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
let saveTimer = null;

function salvarNoFirebase() {
  if (!firebasePronto) return;
  if (carregandoDoFirebase) return;

  // ✅ junta vários saves em 1 (evita salvar em loop)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const payload = {
      atualizadoEm: new Date().toISOString(),
      ocorrencias, maquinas, acertos, usuarios,
    };

    try {
      await setDoc(docRef, payload, { merge: true });
    } catch (err) {
      console.error("❌ Firebase save error:", err);
      alert("❌ Não consegui salvar no Firebase.\n\n" + (err?.message || err));
    }
  }, 300);
}



 
async function iniciarSincronizacaoFirebase() {
  try {
    await signInAnonymously(auth); // ✅ entra no Firebase sem pedir nada
  } catch (e) {
    console.error("❌ Auth anônimo falhou:", e);
    alert("❌ Falha ao conectar no Firebase (Auth anônimo).");
    return;
  }

  await garantirDocExiste();


  onSnapshot(
  docRef,
  (snap) => {
    carregandoDoFirebase = true;

    const data = snap.data() || {};
    ocorrencias = Array.isArray(data.ocorrencias) ? data.ocorrencias : [];
    maquinas = Array.isArray(data.maquinas) ? data.maquinas : [];
    maquinas = maquinas.map(normalizarGPSMaquina);

    acertos  = Array.isArray(data.acertos) ? data.acertos : [];
    usuarios = Array.isArray(data.usuarios) ? data.usuarios : [];

    carregandoDoFirebase = false;

    firebasePronto = true;
    habilitarBotaoLogin();

    garantirAdminPadrao();

    try { atualizarAlertaOcorrencias(); } catch {}
    try { listarOcorrencias(); } catch {}
    try { listarMaquinas(); } catch {}
    try { atualizarStatus(); } catch {}
    try { if (typeof listarLocaisSalvos === "function") listarLocaisSalvos(); } catch {}
  },
  (err) => {
    carregandoDoFirebase = false;
    firebasePronto = false;
    desabilitarBotaoLogin();
    console.error("❌ Firebase snapshot error:", err);
    alert("❌ Firebase não conectou.\n\n" + (err?.message || err));
  }
);

} // ✅ FECHA iniciarSincronizacaoFirebase()



function atualizarAlertaOcorrencias() {
  const btn = document.getElementById("btnOcorrencias");
  if (!btn) return;

  const temPendentes = (ocorrencias || []).length > 0;
  btn.classList.toggle("tem-alerta", temPendentes);
}



function getAdminSenha() {
  return localStorage.getItem("ADMIN_SENHA") || "1234";
}
function setAdminSenha(nova) {
  localStorage.setItem("ADMIN_SENHA", String(nova));
}

// cria a senha padrão só se ainda não existir
if (!localStorage.getItem("ADMIN_SENHA")) {
  localStorage.setItem("ADMIN_SENHA", "1234");
}


// =====================
// ✅ LOGIN / USUÁRIOS
// =====================

function formatarTelefoneBR(valor) {
  // fica só com números
  const nums = String(valor || "").replace(/\D/g, "").slice(0, 11); // 2 DDD + 9 tel

  const ddd = nums.slice(0, 2);
  const tel = nums.slice(2); // até 9 dígitos

  // ainda digitando DDD
  if (nums.length <= 2) return ddd ? `(${ddd}` : "";

  // tel com 9 dígitos: 99999-9999 (quando tiver 11 no total)
  if (tel.length >= 9) {
    const p1 = tel.slice(0, 5);
    const p2 = tel.slice(5, 9);
    return `(${ddd}) ${p1}${p2 ? "-" + p2 : ""}`;
  }

  // tel com 8 dígitos: 9999-9999 (quando tiver 10 no total)
  const p1 = tel.slice(0, 4);
  const p2 = tel.slice(4, 8);
  return `(${ddd}) ${p1}${p2 ? "-" + p2 : ""}`;
}

// ativa máscara no campo do cadastro
function ativarMascaraTelefoneCampos() {
  const ids = ["foneCliente", "detFone"];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("input", () => {
      el.value = formatarTelefoneBR(el.value);
    });
  });
}

window.addEventListener("load", ativarMascaraTelefoneCampos);

iniciarSincronizacaoFirebase();
atualizarAlertaOcorrencias();

let adminPadraoJaGarantido = false;

function garantirAdminPadrao() {
  if (adminPadraoJaGarantido) return;

  const jaTemAdmin = (usuarios || []).some(u =>
    String(u.tipo || "").toUpperCase() === "ADMIN" &&
    String(u.user || "").toLowerCase() === "admin"
  );

  if (jaTemAdmin) {
    adminPadraoJaGarantido = true;
    return;
  }

  usuarios.push({
    id: "ADMIN_PADRAO",         // ✅ ID FIXO (não duplica)
    tipo: "ADMIN",
    nome: "ADMIN",
    user: "admin",
    senha: "1234",
  });

  adminPadraoJaGarantido = true;
  salvarNoFirebase();
}




function salvarSessao(u) {
  sessaoUsuario = { tipo: u.tipo, nome: u.nome, user: u.user };
  // ❌ não salva mais no localStorage
}

function limparCamposLogin() {
  const u = document.getElementById("loginUser");
  const s = document.getElementById("loginSenha");

  if (u) u.value = "";
  if (s) s.value = "";

  // alguns navegadores preenchem depois do load, então limpamos de novo
  setTimeout(() => {
    if (u) u.value = "";
    if (s) s.value = "";
  }, 50);
}



function sair() {
  sessaoUsuario = null;
  localStorage.removeItem("sessaoUsuario");
  mostrarTelaLogin();
  limparCamposLogin();
}


function isAdmin() {
  return sessaoUsuario && sessaoUsuario.tipo === "ADMIN";
}

function isLogado() {
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

// =====================
// ✅ TELAS: LOGIN / APP
// =====================
function mostrarTelaLogin() {
  const tl = document.getElementById("telaLogin");
  const app = document.getElementById("app");

  if (tl) tl.classList.remove("escondido");
  if (app) app.classList.add("escondido");

  atualizarPublicoOcorrenciaAuto();
}

function mostrarApp() {
  const tl = document.getElementById("telaLogin");
  const app = document.getElementById("app");

  if (tl) tl.classList.add("escondido");
  if (app) app.classList.remove("escondido");
}

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

    // se alguém tentar clicar mesmo assim
    rAnt.addEventListener("click", () => {
      alert("❌ Somente o ADMIN pode alterar o Relógio Anterior.");
    });
  } else {
    rAnt.disabled = false;
    rAnt.style.opacity = "1";
    rAnt.style.cursor = "text";
    rAnt.title = "";
  }
}



function entrarLogin(tipo) {
  if (!firebasePronto) {
    return alert("⏳ Carregando do Firebase... aguarde 2 segundos e tente novamente.");
  }

  


  // ✅ normaliza o tipo vindo do select
  tipo = String(tipo || "").toUpperCase();
  if (tipo.includes("ADMIN")) tipo = "ADMIN";
  if (tipo.includes("COLAB")) tipo = "COLAB";

  const user = (document.getElementById("loginUser")?.value || "").trim().toLowerCase();
  const senha = (document.getElementById("loginSenha")?.value || "").trim();

  if (!user || !senha) return alert("❌ Preencha usuário e senha.");

  const u = (usuarios || []).find(x =>
    String(x.tipo).toUpperCase() === String(tipo).toUpperCase() &&
    String(x.user).toLowerCase() === user &&
    String(x.senha) === senha
  );

  if (!u) return alert("❌ Login inválido.");

  salvarSessao(u);
  mostrarApp();
  aplicarPermissoesUI();
  atualizarAlertaOcorrencias();
}



window.addEventListener("load", () => {
  // sempre exigir login ao abrir/recarregar a página
  sessaoUsuario = null;
  localStorage.removeItem("sessaoUsuario");
  mostrarTelaLogin();

  // limpa campos do login (pra não ficar nada preenchido)
  const u = document.getElementById("loginUser");
  const s = document.getElementById("loginSenha");
  if (u) u.value = "";
  if (s) s.value = "";
});



// =====================
// ✅ ADMIN: criar colaboradores
// =====================
function adicionarColaborador() {
  if (!exigirAdmin()) return;

  const nome = (document.getElementById("colabNome")?.value || "").trim().toUpperCase();
  const user = (document.getElementById("colabUser")?.value || "").trim().toLowerCase();
  const senha = (document.getElementById("colabSenha")?.value || "").trim();

  if (!nome || !user || !senha) return alert("❌ Preencha nome, usuário e senha.");

  const whats = (document.getElementById("colabWhats")?.value || "").trim();

usuarios.push({
  id: Date.now(),
  tipo: "COLAB",
  nome: nome,
  user: user,
  senha: senha,
  whats: whats // ✅ WhatsApp do colaborador
});


  salvarNoFirebase();

  document.getElementById("colabNome").value = "";
  document.getElementById("colabUser").value = "";
  document.getElementById("colabSenha").value = "";

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
  return (usuarios || [])
    .filter(u => String(u.tipo || "").toUpperCase() === "COLAB")
    .map(u => ({ ...u, whats: normalizarWhats(u.whats) }))
    .filter(u => !!u.whats);
}

// abre Whats no celular/pc já com texto
function abrirWhatsTexto(numero11, msg) {
  const tel = normalizarWhats(numero11);
  if (!tel) return false;

  const url = `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`;

  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();

  return true;
}



function listarColaboradores() {
  if (!exigirAdmin()) return;

  const ul = document.getElementById("listaColabs");
  if (!ul) return;
  ul.innerHTML = "";

  const lista = usuarios.filter(x => x.tipo === "COLAB");
  if (!lista.length) {
    ul.innerHTML = "<li>Nenhum colaborador cadastrado.</li>";
    return;
  }

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

function salvarOcorrenciaPublica() {
  const num = (document.getElementById("pubOcNum")?.value || "").trim().toUpperCase();
  const estab = (document.getElementById("pubOcEstab")?.value || "").trim().toUpperCase();
  const obs = (document.getElementById("pubOcObs")?.value || "").trim();

  if (!num) return alert("❌ Digite o número da máquina.");
  if (!estab || estab.includes("NÃO ENCONTRADA")) return alert("❌ Máquina não encontrada.");
  if (!obs) return alert("❌ Escreva a observação.");

  ocorrencias.push({
    id: Date.now(),
    numero: num,
    estab: estab,
    obs: obs,
    data: new Date().toISOString(),
    origem: "CLIENTE" // só pra identificar
  });

  salvarNoFirebase();

  document.getElementById("pubOcNum").value = "";
  document.getElementById("pubOcEstab").value = "";
  document.getElementById("pubOcObs").value = "";
  atualizarAlertaOcorrencias();
  alert("✅ Ocorrência enviada!");
}




function normalizarStatus(s) {
  return (s || "ALUGADA")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // tira acento: DEPÓSITO -> DEPOSITO
}




// ======================
// ✅ NAVEGAÇÃO (CORRIGIDA)
// ======================
function abrir(id) {
  const menu = document.getElementById("menu");
  const titulo = document.getElementById("tituloApp");
  const subtitulo = document.getElementById("subtitulo");

  // esconde cabeçalho + menu
  if (menu) menu.style.display = "none";
  if (titulo) titulo.style.display = "none";
  if (subtitulo) subtitulo.style.display = "none";

  // esconde todas as telas (boxes)
  document.querySelectorAll(".box").forEach(b => b.classList.add("escondido"));

  // mostra a tela pedida
  const tela = document.getElementById(id);
  if (tela) tela.classList.remove("escondido");

  // atualizações específicas
  if (id === "status") window.atualizarStatus?.();
if (id === "clientes") window.listarMaquinas?.();
if (id === "ocorrencias") window.listarOcorrencias?.();
if (id === "colaboradores") window.listarColaboradores?.();


  if (id === "acerto") {
  aplicarPermissoesUI(); // ✅ garante o bloqueio pro COLAB sempre
  const r = document.getElementById("resultado");
  if (r) r.innerHTML = "";
  atualizarPreviewAcerto();
  }

  if (id === "localizacao") {
    if (typeof listarLocaisSalvos === "function") listarLocaisSalvos();
  }
}

function voltar() {
  const menu = document.getElementById("menu");
  const titulo = document.getElementById("tituloApp");
  const subtitulo = document.getElementById("subtitulo");

  // esconde todas as telas internas
  document.querySelectorAll(".box").forEach(b => b.classList.add("escondido"));

  // mostra cabeçalho + menu
  if (titulo) titulo.style.display = "block";
  if (subtitulo) subtitulo.style.display = "block";

  // ⚠️ aqui é o pulo do gato: o menu tem que voltar como FLEX, não como block
  if (menu) menu.style.display = "flex";
}


// ✅ garante que onclick="" do HTML enxergue
window.abrir = abrir;
window.voltar = voltar;



/* ======================
   CADASTRO DE MÁQUINA
   (NÃO MEXE NA LÓGICA QUE JÁ FUNCIONOU)
====================== */
function salvarMaquina() {
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

  // ✅ GPS capturado no botão "Pegar GPS" (Cadastro)
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

    // ✅ SALVA O GPS REAL NA MÁQUINA
    lat,
    lng,

    resetStatusAt: null,
  });

  // ✅ depois de salvar limpa o GPS temporário
  cadastroGeoTemp = null;

  salvarNoFirebase();
  alert("✅ Máquina cadastrada com sucesso");

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
  // mantém menu escondido, só volta pra lista do status
  document.querySelectorAll(".box").forEach((b) => b.classList.add("escondido"));
  document.getElementById("status").classList.remove("escondido");
}

function abrirDetalhesCliente(estab) {
  document.querySelectorAll(".box").forEach((b) => b.classList.add("escondido"));
  document.getElementById("detalhesStatus").classList.remove("escondido");

  const titulo = document.getElementById("tituloDetalhes");
  const resumo = document.getElementById("resumoDetalhes");
  const lista = document.getElementById("listaDetalhes");

  titulo.textContent = `📊 ${estab} — Acertos do Mês`;
  resumo.innerHTML = "";
  lista.innerHTML = "";

  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const acertosMes = acertos
    .filter((a) => {
      const d = new Date(a.data);
      return (
        String(a.estab).toUpperCase().trim() === String(estab).toUpperCase().trim() &&
        d.getMonth() === mesAtual &&
        d.getFullYear() === anoAtual
      );
    })
    .sort((a, b) => new Date(a.data) - new Date(b.data));

  if (acertosMes.length === 0) {
    lista.innerHTML = "<li>❌ Nenhum acerto neste mês</li>";
    return;
  }

  let somaPix = 0,
    somaDin = 0,
    somaEmpresa = 0,
    somaCliente = 0,
    somaRecolher = 0,
    somaRepassar = 0,
    somaTotalRelogio = 0;

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

  resumo.innerHTML = `
    <strong>Resumo do Mês</strong><br>
    🕒 Total pelo relógio: R$ ${somaTotalRelogio.toFixed(2)}<br>
    💳 Pix: R$ ${somaPix.toFixed(2)} | 💵 Dinheiro: R$ ${somaDin.toFixed(2)}<br>
    🏢 Empresa: R$ ${somaEmpresa.toFixed(2)} | 👤 Cliente: R$ ${somaCliente.toFixed(2)}<br>
    💰 A recolher: R$ ${somaRecolher.toFixed(2)} | 💸 A repassar: R$ ${somaRepassar.toFixed(2)}
  `;
}

async function apagarMaquinaAdmin() {
  const cred = await pedirCredenciaisAdmin();
  if (cred === null) return;

  if (!validarCredenciaisAdmin(cred)) {
    alert("❌ Usuário ou senha incorretos. Apenas o ADMIN pode apagar.");
    return;
  }

  // ... resto do seu apagarMaquina continua igual ...
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
  maquinaSelecionadaNumero = numero;

  // esconde todas as telas e mostra detalhe
  document.querySelectorAll(".box").forEach(b => b.classList.add("escondido"));
  document.getElementById("detalheMaquina").classList.remove("escondido");

  const m = maquinas.find(x => String(x.numero) == String(numero));
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

  // ✅ TELEFONE (puxa o correto da máquina)
  if (detFone) detFone.value = pegarTelefoneDaMaquina(m);

  // maiúsculas ao digitar
  if (detEstab)   detEstab.oninput   = () => detEstab.value = detEstab.value.toUpperCase();
  if (detCliente) detCliente.oninput = () => detCliente.value = detCliente.value.toUpperCase();
  if (detEndereco) detEndereco.oninput = () => detEndereco.value = detEndereco.value.toUpperCase();
}

// ====== SALVAR ALTERAÇÕES ======

let maquinaSelecionadaNumero = null;

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

  const url = `https://www.google.com/maps?q=${la},${ln}`;

  // ✅ método mais compatível com celular: cria link e clica
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();

  // fallback (se bloquear nova aba)
  setTimeout(() => {
    window.location.href = url;
  }, 300);
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


// =====================
// ✅ "APELIDOS" PARA O HTML (corrige os erros do console)
// =====================

// Botão "Entrar" do login chama fazerLogin()

function fazerLogin() {
  // pega o tipo do select (pode estar "Administrador", "ADMIN", etc.)
  let tipo = (document.getElementById("tipoLogin")?.value || "ADMIN").toString().toUpperCase();

  // normaliza para os mesmos valores do seu sistema: ADMIN / COLAB
  if (tipo.includes("ADMIN")) tipo = "ADMIN";
  if (tipo.includes("COLAB") || tipo.includes("COLABOR")) tipo = "COLAB";

  // usa a sua função real
  entrarLogin(tipo);
}

// Campo "Número da Máquina" na ocorrência pública chama pubOcAutoPorNumero()
function pubOcAutoPorNumero() {
  atualizarPublicoOcorrenciaAuto();
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

function abrirWhats() {
  const numero = pegarNumeroWhatsDoDetalhe();
  if (!numero) return alert("❌ Informe um telefone válido no campo do detalhe.");
  window.open("https://wa.me/55" + numero, "_blank");
}


function avisarTodosColaboradores(msg) {
  const lista = listarColaboradoresComWhats();

  if (!lista.length) {
    alert("❌ Nenhum colaborador com Whats válido cadastrado.");
    return;
  }

  let i = 0;

  const abrirProximo = () => {
    if (i >= lista.length) {
      alert("✅ Abri o WhatsApp para todos os colaboradores.\nAgora é só enviar em cada conversa.");
      return;
    }

    const c = lista[i++];
    const ok = abrirWhatsTexto(c.whats, msg);
    if (!ok) abrirProximo();
  };

  abrirProximo();
}


// deixa global pro onclick do HTML enxergar
window.ligarTelefone = ligarTelefone;
window.abrirWhats = abrirWhats;



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

    btnCancel.onclick = () => fechar(null);

    btnOk.onclick = () => {
      const user = (userEl.value || "").trim().toLowerCase();
      const senha = (passEl.value || "").trim();
      fechar({ user, senha });
    };

    passEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnOk.click();
      if (e.key === "Escape") btnCancel.click();
    });

    userEl.focus();
  });
}

function validarCredenciaisAdmin({ user, senha }) {
  user = String(user || "").trim().toLowerCase();
  senha = String(senha || "").trim();

  const u = (usuarios || []).find(x =>
    String(x.tipo).toUpperCase() === "ADMIN" &&
    String(x.user).toLowerCase() === user &&
    String(x.senha) === senha
  );

  return !!u;
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



// =====================
// ✅ EXPOR FUNÇÕES PRO HTML (porque script.js é type="module")
// =====================
Object.assign(window, {

  atualizarStatus,
crAutoPorNumero,
salvarCreditoRemoto,
avisarTodosColaboradores,
trocarSenhaAdmin,
  trocarCredenciaisAdmin,
  // login
  fazerLogin,
  sair,

  // navegação
  abrir,
  voltar,

  // ocorrência pública
  pubOcAutoPorNumero,
  salvarOcorrenciaPublica,

  // acerto
  autoPorNumero,
  autoPorEstab,
  atualizarPreviewAcerto,
  salvarAcerto,

  // cadastro máquina
  pegarLocalizacaoCadastro,
  salvarMaquina,

  // lista/detalhe máquina
  listarMaquinas,
  abrirDetalheMaquina,
  carregarMaquinaPorNumero,
  atualizarLocalizacaoDetalhe,
  salvarAlteracoesMaquina,
  apagarMaquina,

  // ocorrências internas
  ocAutoPorNumero,
  salvarOcorrencia,
  listarOcorrencias,
  concluirOcorrencia,

  // telefone/whats
  ligarTelefone,
  abrirWhats,

  // histórico
  abrirHistoricoVendas,
  renderHistoricoVendas,

  // colaboradores
  adicionarColaborador,
  listarColaboradores,

  // localização/Maps
  pegarLocalizacao,
  abrirNoMaps,
  listarLocaisSalvos,
  mostrarPainelLocal,
  autoLocalPorNumero,
  autoLocalPorEstab,
  abrirLocalizacaoMaquina,
});

// ✅ TESTE (coloque aqui embaixo, no final do arquivo)
console.log(typeof window.atualizarStatus);
console.log(typeof window.crAutoPorNumero);
console.log(typeof window.avisarTodosColaboradores);


window.addEventListener("load", () => {
  const u = document.getElementById("loginUser");
  const s = document.getElementById("loginSenha");

  const enterLogin = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fazerLogin(); // ✅ chama o login certo
    }
  };

  u?.addEventListener("keydown", enterLogin);
  s?.addEventListener("keydown", enterLogin);
});



