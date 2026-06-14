// English Runtime 21 — Web MVP (純前端)
// 對話雙人聲 TTS + 麥克風發音評分 + 背景音樂，皆於瀏覽器本機執行。
(function () {
  const DEMO = window.DEMO || {};
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // 手機 Chrome 的語音辨識若未先取得麥克風授權，常直接丟 not-allowed。
  // 故按「跟讀」時先用 getUserMedia 觸發標準權限提示，授權後再開始辨識。
  let micReady = false;
  async function ensureMic() {
    if (micReady) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      micReady = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- TTS ---------------- */
  // 角色固定：A = Mia(女) / B = Leo(男)。各裝置可用語音清單與順序不同 (桌機/手機),
  // 故改成「依角色挑性別相符的語音」，挑不到就用同一基準聲、以音高區隔 (A 高/B 低),
  // 確保各裝置表現一致 (A 偏女、B 偏男)，不會像之前手機出現男女顛倒。
  let sysVoices = [];
  const FEMALE_HINT = /female|woman|zira|aria|jenny|eva|hazel|susan|samantha|catherine|sonia|libby|clara|michelle|natasha|google us english|google uk english female/i;
  const MALE_HINT = /male|\bman\b|david|mark|guy|george|james|ryan|brian|eric|alex|daniel|fred|liam|william|matthew|google uk english male/i;
  function ensureVoices() {
    if (sysVoices.length === 0 && typeof speechSynthesis !== 'undefined') {
      sysVoices = speechSynthesis.getVoices();
    }
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = ensureVoices;
  function enVoices() { return sysVoices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en')); }
  // 依說話者回傳 {voice, pitch}
  function pickVoice(speaker) {
    ensureVoices();
    const en = enVoices();
    if (!en.length) return { voice: null, pitch: speaker === 'B' ? 0.8 : 1.12 };
    const female = en.find(v => FEMALE_HINT.test(v.name));
    const male = en.find(v => MALE_HINT.test(v.name) && (!female || v.name !== female.name));
    if (speaker === 'B') {                                  // Leo (男)
      if (male) return { voice: male, pitch: 1.0 };
      return { voice: female || en[0], pitch: 0.8 };        // 無男聲 → 基準聲壓低
    }
    if (female) return { voice: female, pitch: 1.0 };       // Mia (女)
    return { voice: en[0], pitch: 1.12 };                   // 無女聲 → 基準聲提高
  }
  function speak(text, speaker, rate) {
    return new Promise(res => {
      if (typeof speechSynthesis === 'undefined' || !text) return res();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate || 1.0;
      const pv = pickVoice(speaker);
      if (pv.voice) u.voice = pv.voice;
      u.lang = (pv.voice && pv.voice.lang) || 'en-US';
      u.pitch = pv.pitch;
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
    async function record(btn){
      if(!SR){ alert('此瀏覽器不支援語音辨識，請改用 Chrome / Edge。'); return; }
      if(activeRecog){ activeRecog.stop(); return; }
      trEl.textContent='請允許麥克風…';
      const ok = await ensureMic();
      if(!ok){ trEl.textContent='麥克風被封鎖：請點網址列左側的鎖頭/ⓘ → 權限 → 允許麥克風，重新整理後再試。'; return; }
      stopSpeak(); playToken++;
      const r=new SR(); r.lang='en-US'; r.interimResults=true; r.maxAlternatives=1; r.continuous=false;
      let finalText='';
      btn.classList.add('recording'); btn.innerHTML='<i class="fa-solid fa-stop"></i> 停止';
      trEl.textContent='聆聽中…請開始跟讀'; trEl.classList.add('listening');
      bgm.duck();
      r.onresult=e=>{let it='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;
        if(e.results[i].isFinal)finalText+=t;else it+=t;} trEl.textContent=(finalText+' '+it).trim()||'聆聽中…';};
      r.onerror=e=>{
        const M={
          'no-speech':'沒有偵測到語音，請再試一次。',
          'not-allowed':'麥克風被封鎖：請在網址列權限設定允許麥克風後重試。',
          'service-not-allowed':'瀏覽器不允許語音辨識服務（可能是隱私設定或非 Chrome/Edge）。',
          'network':'語音辨識需要網路（Android 由線上服務處理），請確認連線後重試。',
          'aborted':'辨識被中斷，請再按一次跟讀。',
          'audio-capture':'找不到麥克風裝置。',
          'language-not-supported':'此裝置不支援 en-US 辨識。'
        };
        trEl.textContent = M[e.error] || ('辨識錯誤：'+e.error);
      };
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
