import json, math, statistics, datetime, zoneinfo, pathlib

src = json.loads(pathlib.Path('audit/evidence/backtest-rounds.json').read_text())
stored = json.loads(pathlib.Path('shared/src/volatility.json').read_text())
et = zoneinfo.ZoneInfo('America/New_York')
start, end = datetime.date(2026, 6, 23), datetime.date(2026, 10, 2)
holidays = {datetime.date(2026, 7, 3), datetime.date(2026, 9, 7)}
days, date = [], start
while date <= end:
    if date.weekday() < 5 and date not in holidays: days.append(date)
    date += datetime.timedelta(days=1)
result, hours = {}, {}
for symbol, feed in src['feeds'].items():
    rounds, closes = feed['rounds'], []
    for date in days:
        close_ts = int(datetime.datetime.combine(date, datetime.time(16), et).timestamp())
        r = max((r for r in rounds if r['updatedAt'] <= close_ts), key=lambda r: r['updatedAt'])
        closes.append({'date': str(date), 'price': int(r['answer']) / 1e8,
                       'roundUpdatedAt': datetime.datetime.fromtimestamp(r['updatedAt'], datetime.timezone.utc).isoformat().replace('+00:00', 'Z')})
    returns = [math.log(b['price'] / a['price']) for a, b in zip(closes, closes[1:])]
    sigma = statistics.stdev(returns) * math.sqrt(252)
    expected = stored['assets'][symbol]['closes']
    mismatch = [(x, y) for x, y in zip(closes, expected) if x != y]
    largest = sorted([{'date': closes[i + 1]['date'], 'logReturn': value, 'simpleReturn': math.expm1(value)}
                      for i, value in enumerate(returns)], key=lambda r: abs(r['logReturn']), reverse=True)[:3]
    replay = [r for r in rounds if datetime.date(2026, 9, 28) <= datetime.datetime.fromtimestamp(r['updatedAt'], datetime.timezone.utc).date() <= datetime.date(2026, 10, 2)]
    result[symbol] = {'days': len(days), 'returns': len(returns), 'allClosesMatch': not mismatch and len(closes) == len(expected),
                      'mismatches': mismatch, 'sigmaFull': sigma, 'sigmaRounded4': round(sigma, 4),
                      'storedSigma': stored['sigma'][symbol], 'largestMoves': largest, 'replaySept28Oct2Rounds': len(replay)}
    clean_rounds = [r for r in rounds if int(r['answer']) < 10**15]
    outside = []
    for r in clean_rounds:
        ny = datetime.datetime.fromtimestamp(r['updatedAt'], datetime.timezone.utc).astimezone(et)
        if ny.weekday() >= 5 or not 570 <= ny.hour * 60 + ny.minute < 960:
            outside.append({'round': r['round'], 'timestamp': r['updatedAt'], 'newYork': ny.isoformat()})
    hours[symbol] = {'normalizedRounds': len(clean_rounds), 'outsideNYSECore': len(outside), 'examples': outside[:3]}
pathlib.Path('audit/evidence/claims-volatility.json').write_text(json.dumps(result, indent=2) + '\n')
pathlib.Path('audit/evidence/feed-hours.json').write_text(json.dumps(hours, indent=2) + '\n')
print(json.dumps({'volatility': result, 'feedHours': hours}, indent=2))
