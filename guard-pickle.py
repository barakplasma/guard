#!/data/data/com.termux.nix/files/home/.nix-profile/bin/python
from argparse import ArgumentParser
from datetime import datetime, timedelta
from pickle import dump, load
from pprint import pprint
from random import shuffle

from guard import Roster, Guard, Calendar, CItem

def make_guard_list():
    if input("type 'load' to load guards from file or empty to continue") == "load":
        with open('guards.pickle', 'rb') as fp:
            guards=load(fp)
            return guards
    if input("type 'new' to add names manually, otherwise using default") =="new":
        while guards.count('') < 1:
            guards.append(input("type guard name or '' to finish: "))
        guards.pop()
        return guards
    after_exit = "michael,eli,agmon,eilon,yoad,daniel,jonathan,sefinau,aviv,schmidt,elia,or,schwartz"

    before_exit = "michael,nadav,eli,agmon,itai,eilon,yoad,daniel,jonathan,sefinau,yohann,aviv,schmidt,elia,or,schwartz"
    guards = list(map(Guard,after_exit.split(",")))
    shuffle(guards)
    already_guarded = []#"agmon,michael,eli,or,eilon,jonathan,yoad".split(",")
    ag = filter(lambda glg: glg.name in already_guarded, guards)
    for glg in ag:
        glg.guarded = timedelta(hours=1)
        glg.last_guard_shift = datetime.now()

    return guards

parser = ArgumentParser(
description='generates guard shift schedules')
parser.add_argument(
'--start',type=str,default=datetime.now().isoformat(),help='start time for schedule')

#parser.add_argument('--guards', default=guards, type=str, help='comma seperated list of guard names')

parser.add_argument('--duration', default=24, type=int, help="how many hours to generate forward")
parser.add_argument('--shift_length', default=60, type=int, help="how many minutes for each guard shift")
parser.add_argument('--num_positions', default=2, type=int, help="how many guard positions for each shift")
args = parser.parse_args()
defyes = ['y', 'Y', '']
make_new = input("make new? Y/n: ") in defyes
if make_new:
    guards = make_guard_list()

    default = Roster(guards, start=datetime.fromisoformat(args.start), shift_length=timedelta(minutes=args.shift_length),num_positions=args.num_positions)

    default.schedule(timedelta(hours=args.duration))
    pprint(default)
else:
    with open('roster.pickle', 'rb') as fp:
        default = load(fp)
        pprint(default)
        #breakpoint()


if make_new and input("save? Y/n: ") in defyes:
    with open('roster.pickle', 'wb') as fp:
        dump(default, fp)
