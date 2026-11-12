(function(){
  var root=document.documentElement;
  try{var t=localStorage.getItem('theme');if(t)root.setAttribute('data-theme',t)}catch(e){}
  document.getElementById('theme').onclick=function(){
    var dark=getComputedStyle(root).getPropertyValue('--bg').trim()==='#0d100e';
    var n=dark?'light':'dark';root.setAttribute('data-theme',n);
    try{localStorage.setItem('theme',n)}catch(e){}
  };

  /* reveal on scroll */
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
  document.querySelectorAll('.reveal').forEach(function(el){io.observe(el)});

  /* hero demo */
  var cap=document.getElementById('cap'),chips=document.getElementById('chips');
  var styles=[
    {n:'Highlight Select',h:'<span class="w">Stop</span> <span class="w">scrolling</span><br><span class="w">and</span> <span class="w hl">watch this</span>',d:[0,260,520,700,900]},
    {n:'Word Cascade',h:'<span class="w">Every</span> <span class="w">word</span> <span class="w">lands</span><br><span class="w">right</span> <span class="w">on</span> <span class="w">the</span> <span class="w">beat</span>',d:[0,200,400,600,720,840,960]},
    {n:'Pill',h:'<span class="w">Your</span> <span class="w">style,</span><br><span class="w hl rose">your rules</span>',d:[0,260,520]},
    {n:'Pop Up',h:'<span class="w">Make</span> <span class="w">it</span> <span class="w hl">yours</span>',d:[0,260,520]}
  ];
  var idx=0,timer,timers=[];
  styles.forEach(function(s,i){
    var b=document.createElement('button');b.className='chip';b.textContent=s.n;
    b.onclick=function(){clearInterval(timer);play(i);timer=setInterval(next,4200)};
    chips.appendChild(b);
  });
  function play(i){
    idx=i;timers.forEach(clearTimeout);timers=[];
    cap.innerHTML='<div class="ln">'+styles[i].h+'</div>';
    [].forEach.call(chips.children,function(c,k){c.classList.toggle('on',k===i)});
    var ws=cap.querySelectorAll('.w');
    ws.forEach(function(w,k){timers.push(setTimeout(function(){w.classList.add('on')},300+(styles[i].d[k]||k*200)))});
  }
  function next(){play((idx+1)%styles.length)}
  play(0);timer=setInterval(next,4200);

  /* preset cards */
  /* each card plays the app's own rendered preview of that preset (assets/presets/*.mp4, made from the library's preview frames) */
  var ps=[['Pop Up','Bouncy 🏀','pop-up'],['Highlight Select','Punchy 💥','highlight-select'],['Letter Cascade','Smooth 🌊','letter-cascade'],['Glass Pill','Elegant 💎','glass-pill'],['Kinetic Cloud','Energetic ⚡','kinetic-cloud'],['Underline Draw','Simple 🤍','underline-draw'],['$123,456','Bright Money 🤑','money'],['Blur In Fade','Smooth 🌊','blur-in-fade']];
  var g=document.getElementById('pgrid');
  var vio='IntersectionObserver' in window?new IntersectionObserver(function(es){es.forEach(function(e){
    var v=e.target;if(e.isIntersecting){var p=v.play();if(p&&p.catch)p.catch(function(){})}else v.pause();
  })},{threshold:.35}):null;
  ps.forEach(function(p){
    var d=document.createElement('div');d.className='pcard';
    d.innerHTML='<div class="pv"><video src="assets/presets/'+p[2]+'.mp4" muted loop playsinline preload="metadata" aria-label="'+p[0]+' preview"></video></div><b>'+p[0]+'</b><span>'+p[1]+'</span>';
    g.appendChild(d);
    var v=d.querySelector('video');
    if(vio)vio.observe(v);else v.autoplay=true;
  });

  /* rules mock */
  var cols=['#8ccf8e','#f07b8e','#ffd60a','#0a84ff','#ffffff'],fonts=[['Poppins','Poppins, system-ui'],['Larken','Georgia, serif'],['Mono','ui-monospace, Menlo, monospace']];
  var rv=document.getElementById('rv'),rvE=document.getElementById('rvE'),sz=document.getElementById('sz'),pad=document.getElementById('pad'),sw=document.getElementById('sw'),fw=document.getElementById('fonts');
  var col=cols[0];
  function apply(){
    rv.style.fontSize=sz.value*0.55+'px';rv.style.fontFamily=rv.dataset.f||fonts[0][1];
    rvE.style.background=col;rvE.style.color=col==='#ffffff'||col==='#ffd60a'||col==='#8ccf8e'?'#102012':'#fff';
    rvE.style.padding='0 '+(pad.value/100)+'em';
    document.getElementById('o1').textContent=sz.value;document.getElementById('o2').textContent=(pad.value/100).toFixed(2)+'em';
  }
  cols.forEach(function(c,i){var b=document.createElement('button');b.style.background=c;b.setAttribute('aria-label',c);if(!i)b.className='on';b.onclick=function(){col=c;[].forEach.call(sw.children,function(x){x.classList.remove('on')});b.classList.add('on');apply()};sw.appendChild(b)});
  fonts.forEach(function(f,i){var b=document.createElement('button');b.className='chip'+(i?'':' on');b.textContent=f[0];b.onclick=function(){rv.dataset.f=f[1];[].forEach.call(fw.children,function(x){x.classList.remove('on')});b.classList.add('on');apply()};b.style.width='auto';b.style.height='auto';b.style.borderRadius='99px';b.style.border='1px solid var(--line)';fw.appendChild(b)});
  sz.oninput=pad.oninput=apply;apply();
})();

/* app demo: open + play on hover/focus/tap, collapse + rewind on leave */
(function(){
  var win=document.getElementById('appwin'),vid=document.getElementById('appvid'),stage=document.getElementById('demostage');
  if(!win||!vid||!stage)return;
  var rewind,closeT,fitT,isOpen=false;
  function fit(){
    /* once the panel is open, make sure all of it is on screen */
    var r=win.getBoundingClientRect(),m=16,over=r.bottom-(innerHeight-m),under=(60)-r.top;
    if(over>0)scrollBy({top:Math.min(over,r.top-70),behavior:'smooth'});
    else if(under>0)scrollBy({top:-under,behavior:'smooth'});
  }
  function open(){
    clearTimeout(closeT);clearTimeout(rewind);
    if(isOpen)return;isOpen=true;
    win.classList.add('open');stage.classList.add('is-live');
    var p=vid.play();if(p&&p.catch)p.catch(function(){});
    clearTimeout(fitT);fitT=setTimeout(function(){if(isOpen)fit()},700);
  }
  function close(){
    clearTimeout(closeT);
    closeT=setTimeout(function(){
      isOpen=false;clearTimeout(fitT);
      win.classList.remove('open');stage.classList.remove('is-live');vid.pause();
      rewind=setTimeout(function(){try{vid.currentTime=0}catch(e){}},650);
    },3000);   /* stays open 3 s after the cursor leaves; coming back cancels the close */
  }
  var touch=window.matchMedia('(hover:none)').matches;
  if(touch){win.addEventListener('click',function(){isOpen?(clearTimeout(closeT),close()):open()})}
  else{
    win.addEventListener('mouseenter',open);win.addEventListener('mouseleave',close);
    win.addEventListener('focus',open);win.addEventListener('blur',close);
  }

  /* animation timing visualisation */
  (function(){
    var $=function(i){return document.getElementById(i)};
    var stage=$('vzStage');if(!stage)return;
    var TXT='This is El Subtitle Animator Adjustable Animation Timing',TOTAL=90,NAT=36,N=TXT.replace(/ /g,'').length;
    var hs=$('vzHs'),he=$('vzHe'),track=$('vzTrack'),span=$('vzSpan'),hold=$('vzHold'),play=$('vzPlay'),ticks=$('vzTicks');
    var letters=[],k=0;
    TXT.split(' ').forEach(function(word,wi){
      var w=document.createElement('span');w.className='vz-w';
      word.split('').forEach(function(ch){var s=document.createElement('span');s.textContent=ch;letters.push(s);w.appendChild(s)});
      stage.appendChild(w);stage.appendChild(document.createTextNode(' '));
    });
    for(var i=0;i<N;i++){var d=document.createElement('i');ticks.appendChild(d)}
    var S=10,E=46,auto=false,t=0,reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches;
    var pc=function(f){return f/TOTAL*100+'%'};
    function ends(){return {s:S,e:auto?S+NAT:E,auto:auto}}
    function layout(){
      var r=ends();E=r.e;
      $('vzSv').textContent=S;$('vzEv').textContent=r.auto?'0 (preset)':E;
      hs.setAttribute('aria-valuenow',S);he.setAttribute('aria-valuenow',E);
      span.style.left=pc(S);span.style.width=pc(E-S);
      hold.style.left=pc(E);hold.style.width=pc(TOTAL-E);
      var q=ticks.children;for(var i=0;i<q.length;i++)q[i].style.left=pc(S+(E-S)*(i/(q.length-1)));
      $('vzNote').textContent=r.auto
        ?'Frames at 0 uses the preset\'s own timing: the animation takes its natural '+NAT+' frames from frame '+S+'.'
        :(E-S===NAT?'This is the preset\'s natural length.':'The '+NAT+'-frame animation is '+(E-S>NAT?'stretched':'squeezed')+' to '+(E-S)+' frames ('+((E-S)/NAT).toFixed(2)+'x). After frame '+E+' the clip holds the finished text.');
      draw();
    }
    function ease(x){return x<=0?0:x>=1?1:1-Math.pow(1-x,3)}
    function draw(){
      play.style.left=pc(t);
      var p=(t-S)/(E-S);
      letters.forEach(function(el,i){
        var a=ease(p*(1+1.4)-i/(N-1)*1.4);
        el.style.opacity=a;
        el.style.transform='translateY('+((1-a)*.5)+'em) scale('+(.85+.15*a)+')';
        el.style.filter=a<1?'blur('+((1-a)*5)+'px)':'none';
      });
    }
    var last=0;
    function tick(ts){
      var dt=Math.min(ts-last,50);last=ts;
      t+=dt/1000*30;if(t>TOTAL+12)t=0;
      draw();requestAnimationFrame(tick);
    }
    var drag=null;
    function frameAt(ev){var r=track.getBoundingClientRect();return Math.round(Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width))*TOTAL)}
    function begin(kind){return function(ev){ev.preventDefault();ev.stopPropagation();drag={k:kind,off:frameAt(ev)-S,len:E-S};track.setPointerCapture&&track.setPointerCapture(ev.pointerId)}}
    hs.onpointerdown=begin('s');he.onpointerdown=begin('e');
    span.onpointerdown=function(ev){if(ev.target===hs||ev.target===he)return;begin('m')(ev)};
    track.onpointermove=function(ev){
      if(!drag)return;var f=frameAt(ev);
      if(drag.k==='s'){var e0=auto?S+NAT:E;S=Math.max(0,Math.min(f,auto?TOTAL-NAT:e0-1));if(auto)E=S+NAT}
      else if(drag.k==='e'){auto=false;E=Math.max(S+1,f)}
      else{var len=drag.len,s=Math.max(0,Math.min(TOTAL-len,f-drag.off));S=s;E=s+len}
      layout();
    };
    track.onpointerup=track.onpointercancel=function(){drag=null};
    function key(which){return function(ev){
      var d=ev.key==='ArrowRight'?1:ev.key==='ArrowLeft'?-1:0;if(!d)return;ev.preventDefault();d*=ev.shiftKey?5:1;
      if(which==='s'){var e0=auto?S+NAT:E;S=Math.max(0,Math.min(S+d,auto?TOTAL-NAT:e0-1));if(auto)E=S+NAT}
      else{var b0=auto?S+NAT:E;auto=false;E=Math.max(S+1,Math.min(TOTAL,b0+d))}
      layout();
    }}
    hs.onkeydown=key('s');he.onkeydown=key('e');
    $('vzReset').onclick=function(){auto=true;E=S+NAT;layout();if(reduce)t=TOTAL};
    layout();
    if(reduce){t=TOTAL;draw()}else requestAnimationFrame(tick);
  })();
})();
