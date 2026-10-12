# Same trial division, bounds and expected count as primes.js.
def count_primes(limit):
    count = 0
    candidate = 2
    while candidate <= limit:
        prime = True
        divisor = 2
        while divisor * divisor <= candidate:
            if candidate % divisor == 0:
                prime = False
                break
            divisor += 1
        if prime:
            count += 1
        candidate += 1
    return count


def benchmark_workload():
    return count_primes(100000)


print(benchmark_workload())
