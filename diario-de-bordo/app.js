/* =====================================================================
   DIÁRIO DE BORDO · app do colaborador (janela lateral)
   ===================================================================== */
(() => {
  "use strict";
  const CFG = window.DIARIO_CONFIG || {};
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const TZ = "America/Sao_Paulo";
  const LIMITE_FOTO = 280 * 1024;           // o bucket recusa acima de 300 KB
  const MOTIVOS = ["Sem tempo", "Aguardando outra área", "Sistema indisponível", "Outro"];
  const TXT = { feita: "Feita", sem_demanda: "Sem demanda", nao_feita: "Não feita" };
  const COR = { feita: "#17733F", sem_demanda: "#8592A6", nao_feita: "#B42318" };

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hojeISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const horaDe = (iso) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
               set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };

  const IC = {
    som: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8h3l4-3v10l-4-3H3z"/><path d="M13 7.5a3.5 3.5 0 010 5M15.5 5a7 7 0 010 10"/></svg>',
    mudo: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8h3l4-3v10l-4-3H3z"/><path d="M13.5 8l4 4M17.5 8l-4 4"/></svg>',
    janela: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M12 4v12"/></svg>',
    clip: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 9.5l-5 5a3 3 0 01-4.2-4.2l5.5-5.5a2 2 0 112.8 2.8l-5.5 5.5a1 1 0 01-1.4-1.4l5-5"/></svg>',
    lupa: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#5A6577" stroke-width="2"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.5 12.5L17 17"/></svg>',
    seta: '<svg viewBox="0 0 20 20" fill="none" stroke="#5A6577" stroke-width="2"><path d="M5 8l5 5 5-5"/></svg>',
  };

  const S = {
    tela: "carregando", user: null, perfil: null, tarefas: [], registros: [], dia: hojeISO(),
    sel: {}, mot: {}, anexo: {}, ocupada: {}, ativa: null, q: "",
    fechados: ls.get("diario_grupos_fechados", {}), abertas: ls.get("diario_secoes", { nao: true, sem: true, reg: false }),
    mudo: ls.get("diario_mudo", false), modal: null,
  };

  /* ------------------------------------------------------------ sons */
  let ac = null;
  function som(tipo) {
    if (S.mudo) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const seq = { tick: [[1400, .03, .022]], feita: [[660, .12, .045], [990, .12, .045], [1320, .2, .04]], sem_demanda: [[520, .12, .035], [440, .18, .03]],
        nao_feita: [[330, .14, .04], [247, .22, .035]], erro: [[220, .12, .04], [196, .2, .04]], fim: [[523, .1, .04], [659, .1, .04], [784, .1, .04], [1047, .3, .045]] }[tipo] || [];
      seq.forEach(([f, d, v], i) => {
        const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * .075;
        o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + .02);
      });
    } catch { /* navegador sem áudio */ }
  }

  /* ------------------------------------------------------------ avisos */
  let tToast;
  function toast(msg, aviso = false) {
    const el = $("#toast");
    el.className = "toast" + (aviso ? " aviso" : "");
    el.innerHTML = `<span>${esc(msg)}</span><button type="button" aria-label="Fechar aviso">×</button>`;
    el.hidden = false;
    el.querySelector("button").onclick = () => (el.hidden = true);
    clearTimeout(tToast);
    tToast = setTimeout(() => (el.hidden = true), aviso ? 10000 : 3500);
  }

  /* ------------------------------------------------------------ compressão da foto */
  function carregarImagem(file) {
    return new Promise((ok, falha) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(url); falha(new Error("Formato de imagem não suportado")); };
      img.src = url;
    });
  }
  async function comprimir(file) {
    if (!file || !String(file.type).startsWith("image/")) throw new Error("O arquivo não é uma imagem");
    let src;
    try { src = await createImageBitmap(file); } catch { src = await carregarImagem(file); }
    const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    const etapas = [[1280, .72], [1280, .6], [1024, .55], [900, .5], [720, .45], [560, .4], [420, .35]];
    for (const [max, q] of etapas) {
      const k = Math.min(1, max / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(src, 0, 0, w, h);
      let blob = await new Promise((r) => cv.toBlob(r, "image/webp", q));
      if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= LIMITE_FOTO) return blob;
    }
    throw new Error("Não consegui reduzir a imagem o suficiente");
  }
  function definirAnexo(tid, file) {
    if (!file) return;
    if (S.anexo[tid]?.url) URL.revokeObjectURL(S.anexo[tid].url);
    S.anexo[tid] = { file, url: URL.createObjectURL(file), nome: file.name || "print colado.png", kb: Math.round(file.size / 1024) };
    if (S.modal && S.modal.tid === tid) renderModal(); else render();
  }

  /* ------------------------------------------------------------ dados */
  async function carregarPerfil() {
    const { data, error } = await sb.from("profiles").select("*, setores(nome,cor), cargos(nome)").eq("id", S.user.id).single();
    if (error || !data) { S.tela = "semcadastro"; return render(); }
    S.perfil = data;
    if (data.perfil !== "colaborador") { S.tela = "painel"; return render(); }
    if (data.must_change_password) { S.tela = "senha"; return render(); }
    S.tela = "app";
    await carregarDados();
  }
  async function carregarDados() {
    S.dia = hojeISO();
    const [t, r] = await Promise.all([
      sb.from("tarefa_cargos").select("tarefas!inner(id,codigo,descricao,pedir_evidencia,ativa,grupos(letra,nome))")
        .eq("cargo_id", S.perfil.cargo_id).eq("tarefas.ativa", true),
      sb.from("registros").select("id,tarefa_id,codigo,tarefa_desc,status,motivo,criado_em,intervalo_min,evidencia_status")
        .eq("user_id", S.user.id).eq("data", S.dia).order("criado_em", { ascending: false }),
    ]);
    if (t.error || r.error) { toast("Não consegui carregar seus dados. Verifique a conexão.", true); }
    S.tarefas = (t.data || []).map((x) => x.tarefas).filter(Boolean)
      .map((x) => ({ ...x, grupo: x.grupos ? `${x.grupos.letra} · ${x.grupos.nome}` : "Outras", letra: x.grupos?.letra || "Z" }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
    S.registros = r.data || [];
    render();
  }
  function estadoDe(tid) {
    const regs = S.registros.filter((r) => r.tarefa_id === tid);
    return { ultimo: regs[0] || null, feitas: regs.filter((r) => r.status === "feita").length };
  }

  /* ------------------------------------------------------------ registrar */
  async function registrar(tid, status, motivo, substituiId) {
    if (S.ocupada[tid]) return;
    S.ocupada[tid] = true; render();
    const anexo = S.anexo[tid];
    let blob = null, falhaEv = null;
    try {
      if (anexo) {
        try { blob = await comprimir(anexo.file); } catch (e) { falhaEv = e.message; }
      }
      const { data: reg, error } = await sb.from("registros")
        .insert({ tarefa_id: tid, status, motivo: status === "nao_feita" ? motivo : null, substitui_id: substituiId || null })
        .select("id,tarefa_id,codigo,tarefa_desc,status,motivo,criado_em,intervalo_min,evidencia_status").single();
      if (error) throw error;

      if (blob) {
        const ext = blob.type === "image/webp" ? "webp" : "jpg";
        const path = `${S.user.id}/${S.dia.slice(0, 7)}/${reg.id}.${ext}`;
        const up = await sb.storage.from("evidencias").upload(path, blob, { contentType: blob.type, upsert: false });
        if (up.error) falhaEv = up.error.message;
        else {
          const kb = Math.round(blob.size / 1024);
          const u = await sb.from("registros").update({ evidencia_path: path, evidencia_status: "ok", evidencia_kb: kb }).eq("id", reg.id);
          if (u.error) falhaEv = u.error.message; else reg.evidencia_status = "ok";
        }
      }
      if (anexo && falhaEv) {
        await sb.from("registros").update({ evidencia_status: "falhou" }).eq("id", reg.id);
        reg.evidencia_status = "falhou";
      }

      S.registros.unshift(reg);
      delete S.sel[tid]; delete S.mot[tid];
      if (anexo) { URL.revokeObjectURL(anexo.url); delete S.anexo[tid]; }
      const t = S.tarefas.find((x) => x.id === tid);
      if (anexo && falhaEv) {
        toast(`${t?.codigo || "Tarefa"} registrada, mas o anexo não subiu (${falhaEv}). A tarefa ficou salva sem evidência.`, true);
        som("erro");
      } else {
        const base = substituiId ? "Remarcada como " + TXT[status].toLowerCase() + " · o registro anterior continua no histórico"
          : status === "feita" ? `Feita registrada${blob ? " com evidência (" + Math.round(blob.size / 1024) + " KB)" : ""} · ${t?.codigo}`
          : status === "sem_demanda" ? 'Movida para "Sem demanda hoje"' : 'Movida para "Não feitas hoje"';
        toast(base);
        const todas = S.tarefas.every((x) => estadoDe(x.id).ultimo);
        som(todas ? "fim" : status);
      }
    } catch (e) {
      toast("Não foi possível registrar: " + (e.message || e), true);
      som("erro");
    } finally {
      delete S.ocupada[tid];
      render();
    }
  }

  function tentarRegistrar(tid, substituiId) {
    const status = substituiId ? S.modal.sel : S.sel[tid];
    const motivo = substituiId ? S.modal.mot : S.mot[tid];
    if (!status || (status === "nao_feita" && !motivo)) return;
    const t = S.tarefas.find((x) => x.id === tid);
    if (status === "feita" && t?.pedir_evidencia && !S.anexo[tid]) {
      S.modal = { tipo: "evidencia", tid, status, motivo, substituiId };
      return renderModal();
    }
    fecharModal();
    registrar(tid, status, motivo, substituiId);
  }

  /* ------------------------------------------------------------ telas */
  function telaLogin(msg = "") {
    return `<div class="tela">
      <div class="marca"><i></i>DIÁRIO DE BORDO</div>
      <h1>Entrar</h1>
      <form id="f-login" style="display:flex;flex-direction:column;gap:14px">
        <label class="campo">Usuário
          <span class="sufixo"><input name="u" autocomplete="username" required autofocus><span>@${esc(CFG.EMAIL_DOMINIO)}</span></span></label>
        <label class="campo">Senha<input name="s" type="password" autocomplete="current-password" required></label>
        <div class="erro">${esc(msg)}</div>
        <button class="btn prim" type="submit">ENTRAR</button>
      </form>
      <p>Esqueceu a senha? Peça ao administrador uma senha temporária.</p>
    </div>`;
  }
  function telaSenha(msg = "") {
    return `<div class="tela">
      <div class="marca"><i></i>DIÁRIO DE BORDO</div>
      <h1>Crie sua senha</h1>
      <p>Você entrou com uma senha temporária. Defina uma só sua para continuar.</p>
      <form id="f-senha" style="display:flex;flex-direction:column;gap:14px">
        <label class="campo">Nova senha<input name="a" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="campo">Repita a nova senha<input name="b" type="password" autocomplete="new-password" minlength="8" required></label>
        <div class="erro">${esc(msg)}</div>
        <button class="btn prim" type="submit">Salvar e entrar</button>
      </form>
    </div>`;
  }
  function telaAviso(titulo, texto, link) {
    return `<div class="tela"><div class="marca"><i></i>DIÁRIO DE BORDO</div><h1>${esc(titulo)}</h1><p>${esc(texto)}</p>
      ${link ? `<a class="btn prim" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${esc(link)}">Abrir o painel</a>` : ""}
      <button class="btn" data-act="sair" type="button">Sair</button></div>`;
  }

  function cartao(t) {
    const st = estadoDe(t.id), v = S.sel[t.id], m = S.mot[t.id], a = S.anexo[t.id];
    const pronto = v && (v !== "nao_feita" || m);
    return `<article class="tarefa${S.ocupada[t.id] ? " ocupada" : ""}" data-tid="${t.id}">
      <div class="tt"><h3>${esc(t.descricao)}</h3><span class="cod">${esc(t.codigo)}</span></div>
      ${st.feitas ? `<span class="feita-badge">Feita ${st.feitas}x hoje · última às ${horaDe(st.ultimo.criado_em)}</span>` : ""}
      <div class="status3" role="group" aria-label="Status">
        ${["feita", "sem_demanda", "nao_feita"].map((s) => `<button type="button" class="st ${s}${v === s ? " on" : ""}" aria-pressed="${v === s}" data-act="sel" data-v="${s}">${TXT[s]}</button>`).join("")}
      </div>
      ${v === "nao_feita" ? `<div class="motivos"><b>Motivo</b>${MOTIVOS.map((o) => `<button type="button" class="mot${m === o ? " on" : ""}" data-act="mot" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
      ${a ? `<div class="anexo"><img src="${a.url}" alt=""><div><b>${esc(a.nome)}</b><span>${a.kb} KB · será comprimida antes de enviar</span></div><button type="button" data-act="tirar">Remover</button></div>` : ""}
      <div class="acoes">
        <button type="button" class="btn-ev${a ? " on" : ""}" data-act="anexar" title="Anexar imagem (ou clique e cole um print com Ctrl+V)">${IC.clip}${a ? "Trocar" : "Evidência"}</button>
        <button type="button" class="btn-reg" data-act="registrar" ${pronto ? "" : "disabled"}>${S.ocupada[t.id] ? "Enviando…" : "Registrar"}</button>
      </div>
      ${S.ativa === t.id && !a ? `<span class="dica">Dica: com esta tarefa selecionada, cole um print com Ctrl+V.</span>` : ""}
    </article>`;
  }

  function telaApp() {
    const p = S.perfil, q = norm(S.q.trim());
    const comStatus = S.tarefas.filter((t) => estadoDe(t.id).ultimo).length;
    const nFeita = S.tarefas.filter((t) => estadoDe(t.id).ultimo?.status === "feita").length;
    const naoL = S.tarefas.filter((t) => estadoDe(t.id).ultimo?.status === "nao_feita");
    const semL = S.tarefas.filter((t) => estadoDe(t.id).ultimo?.status === "sem_demanda");
    const pend = S.tarefas.filter((t) => { const u = estadoDe(t.id).ultimo; return !u || u.status === "feita"; });
    const vis = pend.filter((t) => !q || norm(t.descricao).includes(q) || norm(t.codigo).includes(q) || norm(t.grupo).includes(q));
    const grupos = [...new Set(vis.map((t) => t.grupo))];
    const ints = S.registros.map((r) => r.intervalo_min).filter((x) => x != null);
    const media = ints.length ? Math.round(ints.reduce((a, b) => a + b, 0) / ints.length) + " min" : "—";
    const pct = S.tarefas.length ? Math.round(comStatus / S.tarefas.length * 100) : 0;
    const agora = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
    const linhaItem = (t, extra) => { const u = estadoDe(t.id).ultimo; return `<div class="item"><div><span class="t1">${esc(t.descricao)}</span><span class="t2">${esc(t.codigo)} · ${horaDe(u.criado_em)}${extra ? " · " + esc(extra) : ""}</span></div><button type="button" class="btn-rm" data-act="remarcar" data-tid="${t.id}">Remarcar</button></div>`; };

    return `<header class="topo">
      <div class="linha1"><span class="marca"><i></i>DIÁRIO DE BORDO</span>
        <button type="button" class="ico" data-act="janela" title="Abrir como janela lateral" aria-label="Abrir como janela lateral">${IC.janela}</button>
        <button type="button" class="ico" data-act="mudo" title="${S.mudo ? "Ligar sons" : "Desligar sons"}" aria-label="${S.mudo ? "Ligar sons" : "Desligar sons"}">${S.mudo ? IC.mudo : IC.som}</button>
        <button type="button" class="mini" data-act="sair">Sair</button></div>
      <div class="linha2"><div><strong>${esc(p.nome)}</strong><small>${esc(p.setores?.nome || "")} · ${esc(p.cargos?.nome || "")}</small></div><span class="relogio">${esc(agora)}</span></div>
    </header>
    <section class="bloco resumo">
      <div class="cab"><span><b>${comStatus}</b> de ${S.tarefas.length} com status</span><small>média entre registros <b style="font-size:11px;color:#142033">${media}</b></small></div>
      <div class="barra"><i style="width:${pct}%"></i></div>
      <div class="chips"><span class="c-ok"><b>${nFeita}</b> feitas</span><span class="c-sem"><b>${semL.length}</b> sem dem.</span><span class="c-nao"><b>${naoL.length}</b> não feitas</span></div>
    </section>
    <label class="busca">${IC.lupa}<input id="busca" type="search" aria-label="Buscar tarefa" placeholder="Buscar código ou texto (A001)" value="${esc(S.q)}"></label>
    <div class="rotulo"><span>A FAZER HOJE · ${pend.length}</span></div>
    ${!S.tarefas.length ? `<p class="vazio">Nenhuma tarefa cadastrada para o seu cargo. Fale com o seu gestor.</p>` : ""}
    ${grupos.map((g) => { const aberto = !S.fechados[g] || !!q; const ts = vis.filter((t) => t.grupo === g);
      return `<section class="grupo${aberto ? " aberto" : ""}"><button type="button" data-act="grupo" data-g="${esc(g)}" aria-expanded="${aberto}"><i></i><span class="tit">${esc(g)}</span><small>${ts.length}</small>${IC.seta}</button>${aberto ? ts.map(cartao).join("") : ""}</section>`; }).join("")}
    ${S.tarefas.length && !grupos.length ? `<p class="vazio">Nenhuma tarefa pendente${q ? " com esse filtro" : ""}.</p>` : ""}
    <section class="secao nao"><button type="button" data-act="secao" data-s="nao"><b>Não feitas hoje · ${naoL.length}</b><small>resolveu? Remarcar</small></button>
      ${S.abertas.nao ? naoL.map((t) => linhaItem(t, estadoDe(t.id).ultimo.motivo)).join("") : ""}</section>
    <section class="secao sem"><button type="button" data-act="secao" data-s="sem"><b>Sem demanda hoje · ${semL.length}</b><small>apareceu? Remarcar</small></button>
      ${S.abertas.sem ? semL.map((t) => linhaItem(t)).join("") : ""}</section>
    <section class="secao reg"><button type="button" data-act="secao" data-s="reg"><b>Registros de hoje · ${S.registros.length}</b><small>nada é apagado ao remarcar</small></button>
      ${S.abertas.reg ? S.registros.map((r) => `<div class="item"><span class="hora">${horaDe(r.criado_em)}</span><span class="ponto" style="background:${COR[r.status]}"></span><div><span class="t1">${esc(r.tarefa_desc)}</span><span class="t2">${esc(r.codigo)} · ${TXT[r.status]}${r.motivo ? " (" + esc(r.motivo) + ")" : ""} · ${r.intervalo_min ?? 0} min${r.evidencia_status === "ok" ? " · com evidência" : ""}${r.evidencia_status === "falhou" ? ' · <span class="aviso-ev">anexo falhou</span>' : ""}</span></div></div>`).join("") : ""}</section>`;
  }

  function render() {
    const app = $("#app");
    const foco = document.activeElement?.id === "busca" ? document.activeElement.selectionStart : null;
    if (S.tela === "login") app.innerHTML = telaLogin(S.msg);
    else if (S.tela === "senha") app.innerHTML = telaSenha(S.msg);
    else if (S.tela === "painel") app.innerHTML = telaAviso("Este acesso é do painel", "Gestores e administradores usam o painel de gestão, não o diário.", CFG.PAINEL_URL);
    else if (S.tela === "semcadastro") app.innerHTML = telaAviso("Cadastro incompleto", "Seu usuário existe, mas ainda não tem cadastro no Diário. Fale com o seu gestor.");
    else if (S.tela === "app") app.innerHTML = telaApp();
    else app.innerHTML = '<div class="carregando">Carregando…</div>';
    if (foco !== null) { const b = $("#busca"); if (b) { b.focus(); b.setSelectionRange(foco, foco); } }
  }

  function renderModal() {
    const el = $("#modal"), M = S.modal;
    if (!M) { el.hidden = true; el.innerHTML = ""; return; }
    const t = S.tarefas.find((x) => x.id === M.tid);
    if (M.tipo === "evidencia") {
      const a = S.anexo[M.tid];
      el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-t">
        <strong id="m-t">Quer anexar uma evidência?</strong>
        <p><b style="color:#142033">${esc(t.codigo)} · ${esc(t.descricao)}</b> vai ser registrada ${a ? "com a imagem abaixo." : "sem foto ou print. Você pode anexar um arquivo ou colar um print (Ctrl+V)."}</p>
        ${a ? `<div class="anexo"><img src="${a.url}" alt=""><div><b>${esc(a.nome)}</b><span>${a.kb} KB · será comprimida</span></div></div>` : ""}
        <button type="button" class="btn prim" data-act="${a ? "m-enviar" : "m-anexar"}">${a ? "Registrar com evidência" : "Anexar evidência"}</button>
        <button type="button" class="btn" data-act="m-sem">Enviar sem evidência</button>
        <button type="button" class="btn" data-act="m-fechar" style="border:0">Cancelar</button></div>`;
    } else if (M.tipo === "remarcar") {
      const u = estadoDe(M.tid).ultimo, pronto = M.sel && (M.sel !== "nao_feita" || M.mot);
      el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-t">
        <span class="sobre">REMARCAR · ${esc(t.codigo)}</span>
        <strong id="m-t">${esc(t.descricao)}</strong>
        <p>Antes: <b>${TXT[u.status]}</b> às ${horaDe(u.criado_em)}. Esse registro continua no histórico.</p>
        <div class="status3">${["feita", "sem_demanda", "nao_feita"].map((s) => `<button type="button" class="st ${s}${M.sel === s ? " on" : ""}" data-act="m-sel" data-v="${s}">${TXT[s]}</button>`).join("")}</div>
        ${M.sel === "nao_feita" ? `<div class="motivos"><b>Motivo</b>${MOTIVOS.map((o) => `<button type="button" class="mot${M.mot === o ? " on" : ""}" data-act="m-mot" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
        <div class="linha"><button type="button" class="btn" data-act="m-fechar">Cancelar</button><button type="button" class="btn prim" data-act="m-registrar" ${pronto ? "" : "disabled"}>Registrar</button></div></div>`;
    }
    el.hidden = false;
  }
  function fecharModal() { S.modal = null; renderModal(); }

  /* ------------------------------------------------------------ eventos */
  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "f-login") {
      let u = f.u.value.trim().toLowerCase();
      const email = u.includes("@") ? u : `${u}@${CFG.EMAIL_DOMINIO}`;
      f.querySelector("button[type=submit]").disabled = true;
      const { data, error } = await sb.auth.signInWithPassword({ email, password: f.s.value });
      if (error) { S.msg = "Usuário ou senha inválidos."; S.tela = "login"; return render(); }
      S.msg = ""; S.user = data.user; await carregarPerfil();
    }
    if (f.id === "f-senha") {
      if (f.a.value.length < 8) { S.msg = "Use pelo menos 8 caracteres."; return render(); }
      if (f.a.value !== f.b.value) { S.msg = "As senhas não conferem."; return render(); }
      const { error } = await sb.auth.updateUser({ password: f.a.value });
      if (error) { S.msg = error.message.includes("different") ? "A nova senha precisa ser diferente da temporária." : error.message; return render(); }
      await sb.rpc("senha_trocada");
      S.msg = ""; S.perfil.must_change_password = false; S.tela = "app"; som("feita"); await carregarDados();
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "busca") { S.q = e.target.value; render(); }
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    const card = e.target.closest(".tarefa");
    if (card) S.ativa = Number(card.dataset.tid);
    if (!b) return;
    const act = b.dataset.act, tid = card ? Number(card.dataset.tid) : Number(b.dataset.tid);
    switch (act) {
      case "sair": await sb.auth.signOut(); S.tela = "login"; S.perfil = null; render(); break;
      case "mudo": S.mudo = !S.mudo; ls.set("diario_mudo", S.mudo); render(); break;
      case "janela": {
        const w = 400, h = Math.min(980, screen.availHeight - 40);
        window.open(location.href, "diario_de_bordo", `popup=yes,width=${w},height=${h},left=${screen.availWidth - w - 10},top=10`);
        break;
      }
      case "grupo": { const g = b.dataset.g; S.fechados[g] = !S.fechados[g]; ls.set("diario_grupos_fechados", S.fechados); render(); break; }
      case "secao": { const s = b.dataset.s; S.abertas[s] = !S.abertas[s]; ls.set("diario_secoes", S.abertas); render(); break; }
      case "sel": S.sel[tid] = b.dataset.v; som("tick"); render(); break;
      case "mot": S.mot[tid] = b.dataset.v; som("tick"); render(); break;
      case "anexar": S.alvoArquivo = tid; $("#arquivo").value = ""; $("#arquivo").click(); render(); break;
      case "tirar": URL.revokeObjectURL(S.anexo[tid].url); delete S.anexo[tid]; render(); break;
      case "registrar": tentarRegistrar(tid); break;
      case "remarcar": S.modal = { tipo: "remarcar", tid, sel: null, mot: null }; S.ativa = tid; renderModal(); break;
      case "m-sel": S.modal.sel = b.dataset.v; som("tick"); renderModal(); break;
      case "m-mot": S.modal.mot = b.dataset.v; renderModal(); break;
      case "m-fechar": fecharModal(); break;
      case "m-registrar": tentarRegistrar(S.modal.tid, estadoDe(S.modal.tid).ultimo.id); break;
      case "m-anexar": S.alvoArquivo = S.modal.tid; $("#arquivo").value = ""; $("#arquivo").click(); break;
      case "m-enviar": case "m-sem": {
        const M = S.modal;
        if (act === "m-sem" && S.anexo[M.tid]) { URL.revokeObjectURL(S.anexo[M.tid].url); delete S.anexo[M.tid]; }
        fecharModal();
        registrar(M.tid, M.status, M.motivo, M.substituiId);
        break;
      }
    }
  });

  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") fecharModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.modal) fecharModal(); });

  $("#arquivo").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f && S.alvoArquivo) definirAnexo(S.alvoArquivo, f);
  });

  document.addEventListener("paste", (e) => {
    if (S.tela !== "app") return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const tid = S.modal?.tid || S.ativa;
    if (!tid) { toast("Clique na tarefa antes de colar o print."); return; }
    e.preventDefault();
    const f = item.getAsFile();
    definirAnexo(tid, new File([f], "print colado.png", { type: f.type }));
  });

  // relógio e virada do dia
  setInterval(() => {
    if (S.tela !== "app") return;
    if (hojeISO() !== S.dia) { S.sel = {}; S.mot = {}; carregarDados(); }
    else { const r = $(".relogio"); if (r) r.textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date()); }
  }, 30000);

  /* ------------------------------------------------------------ início */
  (async () => {
    if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("SEU-PROJETO")) {
      $("#app").innerHTML = telaAviso("Falta configurar", "Edite o arquivo config.js com o endereço e a chave do seu Supabase (veja o TUTORIAL.md).");
      return;
    }
    const { data } = await sb.auth.getSession();
    if (data.session) { S.user = data.session.user; await carregarPerfil(); }
    else { S.tela = "login"; render(); }
    sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { S.tela = "login"; render(); } });
  })();
})();
