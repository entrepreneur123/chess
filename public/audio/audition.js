document.querySelectorAll('button[data-play]').forEach(function(b){b.addEventListener('click',function(){
  var list=Array.prototype.slice.call(document.querySelectorAll('#'+b.dataset.play+' audio'));var i=0;
  function next(){if(i>=list.length)return;var a=list[i++];a.currentTime=0;a.play();a.onended=function(){setTimeout(next,350)};}
  document.querySelectorAll('audio').forEach(function(a){a.pause();a.onended=null});next();});});
document.addEventListener('play',function(e){document.querySelectorAll('audio').forEach(function(a){if(a!==e.target)a.pause()})},true);
