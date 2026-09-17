export function gerarIdCard() {
  return `K-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
