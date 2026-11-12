/* interactive polish: scroll bar, spotlight + tilt cards, magnetic / ripple buttons, current nav link, replayable preset cards */
(function(){
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches;
  var fine=window.matchMedia&&matchMedia('(hover:hover) and (pointer:fine)').matches;
  var $$=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};

  /* stagger reveals within their parent */
  var seen=new Map();
  $$('.reveal').forEach(function(el){var p=el.parentNode,n=seen.get(p)||0;seen.set(p,n+1);el.style.setProperty('--i',Math.min(n,6))});

  /* the stagger delay only belongs to the first reveal; afterwards hovers must not wait for it */
  if('MutationObserver' in window){
    var mo=new MutationObserver(function(ms){ms.forEach(function(m){var e=m.target;if(e.classList.contains('in')&&!e.classList.contains('done'))setTimeout(function(){e.classList.add('done')},1200)})});
    $$('.reveal').forEach(function(e){mo.observe(e,{attributes:true,attributeFilter:['class']})});
  }

  /* scroll progress */
  var bar=document.createElement('div');bar.id='fxbar';document.body.appendChild(bar);
  function prog(){var h=document.documentElement,m=h.scrollHeight-innerHeight;bar.style.transform='scaleX('+(m>0?Math.min(1,scrollY/m):0)+')'}
  addEventListener('scroll',prog,{passive:true});addEventListener('resize',prog);prog();

  /* current section in the nav */
  var links=$$('nav .links a'),map={};
  links.forEach(function(a){var id=a.getAttribute('href').slice(1);var s=document.getElementById(id);if(s)map[id]=a});
  if('IntersectionObserver' in window){
    var so=new IntersectionObserver(function(es){es.forEach(function(e){
      if(e.isIntersecting){links.forEach(function(a){a.classList.remove('cur')});var a=map[e.target.id];if(a)a.classList.add('cur')}
    })},{rootMargin:'-45% 0px -50% 0px'});
    Object.keys(map).forEach(function(id){so.observe(document.getElementById(id))});
  }

  /* spotlight (and tilt on a fine pointer) */
  var cards=$$('.cardx,.pcard,.price,.lim,.onlyin,.viz,.versus>div,.term,.tg');
  cards.forEach(function(c){
    c.classList.add('fxcard');
    c.addEventListener('pointermove',function(ev){
      var r=c.getBoundingClientRect(),x=ev.clientX-r.left,y=ev.clientY-r.top;
      c.style.setProperty('--mx',x+'px');c.style.setProperty('--my',y+'px');
      if(reduce||!fine||c.classList.contains('viz'))return;
      var px=x/r.width-.5,py=y/r.height-.5,k=c.classList.contains('price')||c.classList.contains('pcard')?7:4;
      c.classList.add('tilting');
      c.style.transform='perspective(900px) rotateX('+(-py*k).toFixed(2)+'deg) rotateY('+(px*k).toFixed(2)+'deg) translateY(-3px)';
    });
    c.addEventListener('pointerleave',function(){c.classList.remove('tilting');c.style.transform=''});
  });

  /* magnetic primary buttons */
  if(fine&&!reduce)$$('.btn.primary').forEach(function(b){
    b.addEventListener('pointermove',function(ev){
      var r=b.getBoundingClientRect();
      b.style.transform='translate('+((ev.clientX-r.left-r.width/2)*.18).toFixed(1)+'px,'+((ev.clientY-r.top-r.height/2)*.3).toFixed(1)+'px)';
    });
    b.addEventListener('pointerleave',function(){b.style.transform=''});
  });

  /* ripple on every button */
  $$('.btn').forEach(function(b){
    b.addEventListener('pointerdown',function(ev){
      if(reduce)return;
      var r=b.getBoundingClientRect(),d=Math.max(r.width,r.height)*2.2,s=document.createElement('span');
      s.className='rip';s.style.cssText='width:'+d+'px;height:'+d+'px;left:'+(ev.clientX-r.left-d/2)+'px;top:'+(ev.clientY-r.top-d/2)+'px';
      b.appendChild(s);setTimeout(function(){s.remove()},650);
    });
  });

  /* chips: a pop when picked (the chips are also built later by main.js, so delegate) */
  document.addEventListener('click',function(ev){
    var c=ev.target.closest&&ev.target.closest('.chip');if(!c||reduce)return;
    c.classList.remove('pop');void c.offsetWidth;c.classList.add('pop');
  });

  /* preset cards play again when clicked (built by main.js, so delegate) */
  document.addEventListener('click',function(ev){
    var c=ev.target.closest&&ev.target.closest('.pcard');if(!c||reduce)return;
    var v=c.querySelector('video');if(v){v.currentTime=0;var pr=v.play();if(pr&&pr.catch)pr.catch(function(){})}
  });

  /* hero glows drift with the pointer */
  var hero=document.getElementById('top');
  if(hero&&fine&&!reduce){
    hero.classList.add('fxp');
    hero.addEventListener('pointermove',function(ev){
      var r=hero.getBoundingClientRect();
      hero.style.setProperty('--px',((ev.clientX-r.left)/r.width-.5).toFixed(3));
      hero.style.setProperty('--py',((ev.clientY-r.top)/r.height-.5).toFixed(3));
    });
  }

  /* timeline drag state, so the track can glow while it is being dragged */
  var tr=document.getElementById('vzTrack');
  if(tr){
    tr.addEventListener('pointerdown',function(){tr.classList.add('drag')});
    addEventListener('pointerup',function(){tr.classList.remove('drag')});
    addEventListener('pointercancel',function(){tr.classList.remove('drag')});
  }
})();
