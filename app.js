// English Runtime 21 — Web MVP (純前端)
// 對話雙人聲 TTS + 麥克風發音評分 + 背景音樂，皆於瀏覽器本機執行。
(function () {
  const DEMO = window.DEMO || {};
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  /* ---------------- TTS ---------------- */
  let sysVoices = [];
  let voiceA = '', voiceB = '';
  function ensureVoices() {
    if (sysVoices.length === 0 && typeof speechSynthesis !== 'undefined') {
      sysVoices = speechSynthesis.getVoices();
      const en = sysVoices.filter(v => v.lang.toLowerCase().startsWith('en'));
      if (en.length) {
        voiceA = en[0].name;
        voiceB = (en.find(v => v.name !== voiceA) || en[0]).name;
      }
    }
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = ensureVoices;
  function resolveVoice(name) {
    if (name) { const v = sysVoices.find(x => x.name === name); if (v) return v; }
    return sysVoices.filter(v => v.lang.toLowerCase().startsWith('en'))[0] || null;
  }
  // 以 Promise 朗讀一句；對話依說話者 A/B 選不同語音，若僅有一個語音則為 B 降音高以區隔
  function speak(text, speaker, rate) {
    return new Promise(res => {
      if (typeof speechSynthesis === 'undefined' || !text) return res();
      ensureVoices();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate || 1.0;
      const vA = resolveVoice(voiceA), vB = resolveVoice(voiceB);
      const same = !vA || !vB || vA.name === vB.name;
      const v = speaker === 'B' ? vB : vA;
      if (v) u.voice = v;
      u.lang = (v && v.lang) || 'en-US';
      u.pitch = (speaker === 'B' && same) ? 0.8 : 1.0;
      u.onend = res; u.onerror = res;
      speechSynthesis.speak(u);
    });
  }
  function stopSpeak() { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }

  /* ------------- 發音評分 (詞級 Levenshtein 對齊) ------------- */
  function norm(s){return (s||'').toLowerCase().replace(/[^a-z0-9\s']/g,' ').replace(/\s+/g,' ').trim();}
  function toks(s){const n=norm(s);return n?n.split(' '):[];}
  function align(t,h){
    const m=t.length,n=h.length,dp=Array.from({length:m+1},()=>new Array(n+1).fill(0));
    for(let i=0;i<=m;i++)dp[i][0]=i; for(let j=0;j<=n;j++)dp[0][j]=j;
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++){const c=t[i-1]===h[j-1]?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+c);}
    const ops=[];let i=m,j=n;
    while(i>0||j>0){
      if(i>0&&j>0&&dp[i][j]===dp[i-1][j-1]+(t[i-1]===h[j-1]?0:1)){ops.push({t:t[i-1]===h[j-1]?'ok':'sub',w:t[i-1]});i--;j--;}
      else if(i>0&&dp[i][j]===dp[i-1][j]+1){ops.push({t:'miss',w:t[i-1]});i--;}
      else{ops.push({t:'extra',w:h[j-1]});j--;}
    }
    return {dist:dp[m][n],ops:ops.reverse()};
  }
  function score(target,hyp){
    const t=toks(target),h=toks(hyp),{dist,ops}=align(t,h);
    const acc=Math.max(0,Math.min(100,Math.round((1-dist/Math.max(t.length,1))*100)));
    return {acc,ops};
  }
  function renderDiff(ops){
    const main=ops.filter(o=>o.t!=='extra').map(o=>{
      const c=o.t==='ok'?'w-ok':(o.t==='sub'?'w-sub':'w-miss');return `<span class="${c}">${o.w}</span>`;
    }).join(' ');
    const ex=ops.filter(o=>o.t==='extra').map(o=>o.w);
    return `<div>${main}</div>` + (ex.length?`<div class="diff-extra">多說的字：${ex.join(' ')}</div>`:'');
  }
  function accCls(a){return a>=85?'good':(a>=60?'mid':'low');}

  /* ---------------- 對話渲染 + 互動 ---------------- */
  const linesEl = document.getElementById('lines');
  const d = DEMO.dialogue || {lines:[]};
  document.getElementById('dlg-title-zh').textContent = d.title_zh || '對話跟讀';
  document.getElementById('dlg-title-en').textContent = d.title_en || '';
  document.getElementById('dlg-setting').textContent = d.setting_zh || '';

  let playToken = 0, activeRecog = null;
  d.lines.forEach((ln, idx) => {
    const row = document.createElement('div');
    row.className = 'line ' + ln.speaker;
    row.innerHTML = `
      <div class="avatar">${(ln.role && ln.role[0]) || ln.speaker}</div>
      <div class="line-body">
        <div class="line-meta"><span class="role">${ln.role || ('Speaker ' + ln.speaker)}</span>
          <span class="score">尚未跟讀</span></div>
        <div class="en">${ln.en}</div>
        <div class="zh">${ln.zh}</div>
        <div class="line-ctrls">
          <button class="btn" data-act="play"><i class="fa-solid fa-volume-high"></i></button>
          <button class="btn" data-act="slow"><i class="fa-solid fa-gauge-simple-low"></i> 慢</button>
          <button class="btn rec" data-act="rec"><i class="fa-solid fa-microphone"></i> 跟讀</button>
        </div>
        <div class="transcript"></div>
        <div class="diff"></div>
      </div>`;
    linesEl.appendChild(row);
    const scoreEl = row.querySelector('.score');
    const trEl = row.querySelector('.transcript');
    const diffEl = row.querySelector('.diff');

    async function playLine(rate){
      playToken++; stopSpeak();
      row.classList.add('speaking');
      bgm.duck();
      try { await speak(ln.en, ln.speaker, rate); } finally { bgm.unduck(); }
      row.classList.remove('speaking');
    }
    function record(btn){
      if(!SR){ alert('此瀏覽器不支援語音辨識，請改用 Chrome / Edge。'); return; }
      if(activeRecog){ activeRecog.stop(); return; }
      stopSpeak(); playToken++;
      const r=new SR(); r.lang='en-US'; r.interimResults=true; r.maxAlternatives=1; r.continuous=false;
      let finalText='';
      btn.classList.add('recording'); btn.innerHTML='<i class="fa-solid fa-stop"></i> 停止';
      trEl.textContent='聆聽中…請開始跟讀'; trEl.classList.add('listening');
      bgm.duck();
      r.onresult=e=>{let it='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;
        if(e.results[i].isFinal)finalText+=t;else it+=t;} trEl.textContent=(finalText+' '+it).trim()||'聆聽中…';};
      r.onerror=e=>{trEl.textContent=e.error==='no-speech'?'沒有偵測到語音，請再試一次。':('辨識錯誤：'+e.error);};
      r.onend=()=>{
        activeRecog=null; bgm.unduck();
        btn.classList.remove('recording'); btn.innerHTML='<i class="fa-solid fa-microphone"></i> 跟讀';
        trEl.classList.remove('listening');
        const said=finalText.trim();
        if(!said){ trEl.textContent='沒有偵測到語音，請再試一次。'; return; }
        const {acc,ops}=score(ln.en,said);
        trEl.textContent='你說的：'+said;
        diffEl.innerHTML=renderDiff(ops);
        scoreEl.textContent='準確度 '+acc; scoreEl.className='score '+accCls(acc);
      };
      activeRecog=r; try{r.start();}catch(_){activeRecog=null;bgm.unduck();}
    }
    row.querySelector('[data-act=play]').onclick=()=>playLine(1.0);
    row.querySelector('[data-act=slow]').onclick=()=>playLine(0.7);
    row.querySelector('[data-act=rec]').onclick=e=>record(e.currentTarget);
  });

  document.getElementById('play-all').onclick=async()=>{
    const my=++playToken; stopSpeak(); bgm.duck();
    try{
      const rows=[...document.querySelectorAll('.line')];
      for(let k=0;k<rows.length;k++){
        if(my!==playToken)return;
        const row=rows[k]; row.classList.add('speaking');
        row.scrollIntoView({behavior:'smooth',block:'center'});
        await speak(d.lines[k].en, d.lines[k].speaker, 1.0);
        row.classList.remove('speaking');
        if(my!==playToken)return;
        await new Promise(r=>setTimeout(r,420));
      }
    } finally { bgm.unduck(); }
  };
  document.getElementById('stop-all').onclick=()=>{playToken++;stopSpeak();
    document.querySelectorAll('.line.speaking').forEach(r=>r.classList.remove('speaking'));};

  if(!SR){ document.getElementById('sr-warning').style.display='block'; }

  /* ---------------- 單字卡 ---------------- */
  const cardsEl=document.getElementById('cards');
  (DEMO.cards||[]).forEach(c=>{
    const el=document.createElement('div'); el.className='vcard';
    el.innerHTML=`<div class="h"><div><div class="word">${c.text}</div><div class="mean">${c.zh}</div></div>
      <button class="spk" title="朗讀"><i class="fa-solid fa-volume-high"></i></button></div>
      ${c.example_en?`<div class="ex">${c.example_en}</div>`:''}`;
    el.querySelector('.spk').onclick=async()=>{bgm.duck();try{await speak(c.example_en||c.text,'A',1.0);}finally{bgm.unduck();}};
    cardsEl.appendChild(el);
  });

  /* ---------------- 背景音樂 ---------------- */
  const bgm=(function(){
    const m=DEMO.music||{};
    const audio=new Audio(m.file||''); audio.loop=false; audio.volume=0.4; audio.preload='auto';
    const panel=document.getElementById('bgm-panel'), fab=document.getElementById('bgm-fab');
    const play=document.getElementById('bgm-play'), stop=document.getElementById('bgm-stop');
    const loop=document.getElementById('bgm-loop'), vol=document.getElementById('bgm-vol');
    const now=document.getElementById('bgm-now'), nameEl=document.getElementById('bgm-name');
    const TIER={high:'High 動感',mid:'Mid 適中',low:'Low 舒緩'};
    nameEl.textContent=m.name||'背景音樂';
    if(m.bpm){ now.innerHTML=`<span class="dot"></span>${m.bpm} BPM · ${TIER[m.tier]||''}`; }
    function setIcon(){play.innerHTML=audio.paused?'<i class="fa-solid fa-play"></i>':'<i class="fa-solid fa-pause"></i>';}
    fab.onclick=()=>{panel.classList.add('open');fab.classList.add('hidden');};
    document.getElementById('bgm-min').onclick=()=>{panel.classList.remove('open');fab.classList.remove('hidden');};
    play.onclick=()=>{ if(audio.paused) audio.play().catch(()=>{}); else audio.pause(); };
    stop.onclick=()=>{audio.pause();try{audio.currentTime=0;}catch(_){}};
    loop.onclick=()=>{audio.loop=!audio.loop;loop.classList.toggle('active',audio.loop);};
    vol.oninput=()=>{audio.volume=parseFloat(vol.value);};
    audio.addEventListener('play',setIcon); audio.addEventListener('pause',setIcon);
    audio.addEventListener('ended',setIcon);
    // 跟讀/朗讀時暫停音樂，避免被麥克風收進去或蓋過示範
    let dc=0,dp=false;
    return {
      duck(){dc++; if(dc===1&&!audio.paused){dp=true;audio.pause();}},
      unduck(){dc=Math.max(0,dc-1); if(dc===0&&dp){dp=false;audio.play().catch(()=>{});}}
    };
  })();

  ensureVoices();
})();
