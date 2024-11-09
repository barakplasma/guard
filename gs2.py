from os import path
from csv import DictReader, DictWriter
from argparse import ArgumentParser
from pprint import pprint
from datetime import datetime,timedelta
from dataclasses import dataclass,asdict
from queue import PriorityQueue
from statistics import pvariance
import random

@dataclass()
class Shift:
    start: datetime
    end: datetime
    guards: str
    def __repr__(self):
        dfo = '%d/%m %H:%M'
        return f"{self.start.strftime(dfo)} - {self.end.strftime(dfo)} | {self.guards}"

rows=[]

def stats():
    stats = {}
    for r in rows:
        rg = r.guards.split("\t")
        for g in rg:
            prev = stats.setdefault(g, timedelta(0))
            stats[g] = prev + r.end-r.start
    stats = list(map(lambda s: (round(s[1].total_seconds()/3600, 2), s[0]), stats.items()))
    stats.sort(key=lambda x: x[0])
    print("hours for each guard: " )
    pprint(stats)
    if len(stats)>0:
        print("population variance for guard shifts")
        pprint(round(pvariance(list(map(lambda s: s[0], stats))), 3))

q = PriorityQueue()

guards = {}

parser = ArgumentParser(description='generates guard shift schedules')
parser.add_argument('start',type=datetime.fromisoformat,help='start time for schedule')
parser.add_argument('end',type=datetime.fromisoformat,help='end time for schedule')
parser.add_argument('length',type=lambda x: timedelta(minutes=int(x)),help='length of shift in minutes')
parser.add_argument('positions',type=int,help='count of positions for shifts')
parser.add_argument('guards',type=str, nargs="+",help='guards for the shift')

parser.add_argument('--dry_run',default=False,type=bool,help='dry run without savimg to disk')
parser.add_argument('--seed',default=random.randint(100,999),type=int,help='seed for shuffling guards who didnt guard yet')

args = parser.parse_args()

random.seed(args.seed)
print(f"seed: {args.seed}")

current = args.start

if path.isfile("chedule.csv"):
    with open("chedule.csv","r") as fp:
        dr = DictReader(fp)
        dfo="%Y-%m-%d %H:%M:%S"
        rows.extend(list(map(lambda r: Shift(datetime.strptime(r["start"],dfo),datetime.strptime(r["end"],dfo),r["guards"]),dr)))

rows.sort(key=lambda r: r.start)

stats()

for s in rows:
    for g in s.guards.split("\t"):
        if g in args.guards:
            guards[g] = s.end

for g in args.guards:
    guards[g]=guards.setdefault(g, datetime(1948,1,random.randint(1,30)))
    q.put((guards[g], g))

while current < args.end:
    sg = []
    for _ in range(args.positions):
        ng = q.get()
        sg.append(ng[1])
        newend=current+args.length
        guards[ng[1]] = newend
        q.put((newend, ng[1]))
    sg.sort()
    rows.append(Shift(current,current+args.length,"\t".join(sg)))
    current += args.length

rows.sort(key=lambda r: r.start)

if not args.dry_run:
    with open("chedule.csv","w") as fp:
        dw = DictWriter(fp,["start","end","guards"])
        dw.writeheader()
        rows = list(map(asdict, rows))
        dw.writerows(rows)
else:
    pprint(rows)
    stats()
