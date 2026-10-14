"""Report unsuccessful and incomplete runs alongside correct paired timings."""
import statistics

TASKS = ('fresh_alert', 'stale', 'no_trigger', 'missing')


def summarize(rows):
    finished = [r for r in rows if r['status'] == 'finished']
    methods = {}
    for method in ('manual', 'system'):
        attempted = [r for r in rows if r['method'] == method]
        complete = [r for r in attempted if r['status'] == 'finished']
        methods[method] = {
            'attempted': len(attempted), 'finished': len(complete),
            'unfinished': len(attempted) - len(complete),
            'incorrect': sum(r['score'] < 4 for r in complete),
            'fullyCorrect': sum(r['score'] == 4 for r in complete),
            'completionRate': len(complete) / len(attempted) if attempted else None,
            'fullyCorrectRate': sum(r['score'] == 4 for r in complete) / len(complete) if complete else None,
            'fieldAccuracy': sum(r['score'] for r in complete) / (4 * len(complete)) if complete else None,
            'medianCompletedSeconds': statistics.median(r['durationSeconds'] for r in complete) if complete else None,
        }
    pairs = []
    participants = sorted({r['owner'] for r in rows})
    for owner in participants:
        for task in TASKS:
            group = {m: sorted([r for r in finished if r['owner'] == owner and r['task']['id'] == task and r['method'] == m], key=lambda r: r['startedAt']) for m in methods}
            if all(group.values()):
                first = {m: r[0] for m, r in group.items()}
                pair = {'participant': owner, 'taskId': task,
                        **{m: r['durationSeconds'] for m, r in first.items()},
                        'manualScore': first['manual']['score'], 'systemScore': first['system']['score'],
                        'savedSeconds': round(first['manual']['durationSeconds'] - first['system']['durationSeconds'], 3),
                        'bothCorrect': all(r['score'] == 4 for r in first.values())}
                pairs.append(pair)
    correct = [p for p in pairs if p['bothCorrect']]
    complete_participants = [o for o in participants if sum(p['participant'] == o for p in pairs) == len(TASKS)]
    return {'methods': methods, 'allCompletedPairs': pairs, 'correctPairs': correct,
            'completeParticipants': len(complete_participants),
            'medianAllPairsSavedSeconds': statistics.median(p['savedSeconds'] for p in pairs) if pairs else None,
            'medianCorrectPairsSavedSeconds': statistics.median(p['savedSeconds'] for p in correct) if correct else None,
            'comparisonBasis': '每位参与者每题每种方法采用第一次完成记录；错误与未完成次数单列。时间差必须与正确率一起解读，不推算企业收益。'}
