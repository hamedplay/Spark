import fs from 'node:fs';

// One-time, build-gated split of the oversized reference login stylesheet.
const cssPath = 'src/auth-reference-login.css';
const heroPath = 'src/auth-reference-login-hero.css';
const mainPath = 'src/main.tsx';

const css = fs.readFileSync(cssPath, 'utf8');
const marker = '\n.spark-reference-hero {\n  display: flex;\n  flex-direction: column;\n';
const splitAt = css.indexOf(marker);

if (splitAt < 0) {
  throw new Error('auth reference main hero split marker not found');
}

const foundation = css.slice(0, splitAt).replace(/\s+$/, '') + '\n';
const hero = css.slice(splitAt + 1).replace(/^\s+/, '');

const countLines = (value) => value.split('\n').length;
const foundationLines = countLines(foundation);
const heroLines = countLines(hero);

if (foundationLines > 1000 || heroLines > 1000) {
  throw new Error(`split output still too large: foundation=${foundationLines}, hero=${heroLines}`);
}

fs.writeFileSync(cssPath, foundation);
fs.writeFileSync(heroPath, hero);

let main = fs.readFileSync(mainPath, 'utf8');
const existingImport = "import './auth-reference-login.css';";
const heroImport = "import './auth-reference-login-hero.css';";
if (!main.includes(existingImport)) {
  throw new Error('auth-reference-login.css import not found in main.tsx');
}
if (!main.includes(heroImport)) {
  main = main.replace(existingImport, `${existingImport}\n${heroImport}`);
  fs.writeFileSync(mainPath, main);
}

console.log(`auth-reference-login.css: ${foundationLines} lines`);
console.log(`auth-reference-login-hero.css: ${heroLines} lines`);
