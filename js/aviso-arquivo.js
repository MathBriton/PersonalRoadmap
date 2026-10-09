// Script clássico (não módulo) de propósito: por file:// o navegador não carrega main.js,
// mas carrega este arquivo, e o aviso explica por quê. Fica em arquivo próprio porque a
// política de segurança do servidor (CSP) não permite script inline.
if (location.protocol === 'file:') document.getElementById('aviso-arquivo').hidden = false;
