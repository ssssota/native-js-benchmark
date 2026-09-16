// Change LIMIT identically for every tool when comparing workload sizes.
const LIMIT = 100000;

function countPrimes(limit) {
  let count = 0;
  for (let candidate = 2; candidate <= limit; candidate++) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor++) {
      if (candidate % divisor === 0) {
        prime = false;
        break;
      }
    }
    if (prime) count++;
  }
  return count;
}

console.log(countPrimes(LIMIT));
