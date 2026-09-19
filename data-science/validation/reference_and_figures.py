"""Independent numerical validation and standalone academic figures; never part of React."""
import os, json, csv, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
os.environ["MPLCONFIGDIR"] = str(ROOT / ".cache" / "matplotlib")
import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix
from scipy.stats import spearmanr
import matplotlib
matplotlib.rcParams['svg.hashsalt'] = 'operation-suite-intelligence-v0.2'
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

out = ROOT / "data-science" / "artifacts" / "v0.2"
artifact = json.loads((out / "model.json").read_text(encoding="utf-8"))
scored = json.loads((out / "scored.json").read_text(encoding="utf-8"))
rows = list(csv.DictReader((out / "processed.csv").open(encoding="utf-8")))
periods = artifact["periods"]
results = []
for model in artifact["models"]:
    group = model["group"]
    selected = [r for r in rows if r["tool_id"] + "__" + r["action"] == group]
    part = lambda name: [r for r in selected if periods[name]["start"] <= r["completed_at"] <= periods[name]["end"]]
    train, calibration, test = part("train"), part("calibration"), part("test")
    features = lambda subset: np.array([[float(r["log_duration"])] for r in subset])
    reference = IsolationForest(n_estimators=model["treeCount"], max_samples=model["sampleSize"], random_state=model["seed"], contamination="auto", n_jobs=1)
    reference.fit(features(train))
    threshold = float(np.quantile(-reference.score_samples(features(calibration)), 1-artifact["alert_fraction"]))
    scores = -reference.score_samples(features(test))
    flags = scores > threshold
    actual = np.array([r["expected_anomaly"] == "true" for r in test])
    own = {(r["account_id"], r["execution_id"]): r["detectors"]["IF"]["score"] for r in scored}
    own_scores = [own[(r["account_id"], r["execution_id"])] for r in test]
    correlation = float(spearmanr(scores, own_scores).statistic)
    p, r, f, _ = precision_recall_fscore_support(actual, flags, average="binary", zero_division=0)
    results.append({"group":group, "spearman_score_correlation":correlation, "threshold":threshold,
                    "precision":float(p),"recall":float(r),"f1":float(f),
                    "confusion_matrix":confusion_matrix(actual,flags,labels=[False,True]).tolist(),
                    "behavior_check_pass":correlation>=0.9})
report = {"status":"PASS" if all(r["behavior_check_pass"] for r in results) else "FAIL",
          "python":sys.version.split()[0],"numpy":np.__version__,"scikit_learn":sklearn.__version__,
          "criterion":"Spearman correlation >= 0.90 on held-out scores per tool/action; exact tree equality is not expected.",
          "differences":"Independent RNG and split construction; exact harmonic normalization in JS versus approximation in sklearn. Identical partitions, 200 trees, 256 samples, log_duration and calibration quantile.",
          "results":results}
(out / "reference-validation.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
print(json.dumps(report,indent=2))
charts = json.loads((out / "eda.json").read_text(encoding="utf-8"))["charts"]
figures = out / "figures"
figures.mkdir(exist_ok=True)
titles = {"status":"Executions by outcome","tools":"Executions by tool","histogram":"Duration histogram (seconds)",
          "boxplot":"Duration five-number summary (seconds)","medianP95":"Median and P95 duration (seconds)",
          "executions":"Executions over time","outcomes":"Outcomes over time","normalAnomaly":"Median duration: normal vs known anomaly",
          "anomalies":"Detected anomalies over time","anomalyRate":"Detected anomaly rate (%)","detectorComparison":"Detector F1 comparison",
          "confusion":"Confusion matrix","metrics":"Precision / Recall / F1"}
with PdfPages(figures / "EDA_FIGURES.pdf") as pdf:
    for chart in charts:
        fig, ax = plt.subplots(figsize=(9,5), layout="constrained")
        ax.set_title(titles[chart["title"]] + ("\n"+chart.get("group","") if chart.get("group") else ""))
        kind = chart["kind"]
        if kind == "boxplot":
            s = chart["summary"]
            ax.bxp([{"med":s["median"],"q1":s["p25"],"q3":s["p75"],"whislo":s["min"],"whishi":s["max"],"fliers":[]}],showfliers=False)
        elif kind == "confusion":
            if chart["evaluation_status"] != "EVALUATED":
                ax.text(.5,.5,"NOT EVALUABLE",ha="center",transform=ax.transAxes)
            else:
                matrix=np.array(chart["values"]).reshape(2,2); ax.imshow(matrix,cmap="Blues")
                for y in range(2):
                    for x in range(2): ax.text(x,y,str(matrix[y,x]),ha="center",va="center",color="black")
                ax.set_xticks([0,1],["Normal","Anomaly"]);ax.set_yticks([0,1],["Normal","Anomaly"])
                ax.set_xlabel("Prediction");ax.set_ylabel("Known synthetic label")
        elif kind == "multiline":
            for series in chart["series"]:
                ax.plot([p["label"] for p in series["points"]],[p["value"] for p in series["points"]],label=series["name"])
            ax.legend()
        else:
            points=[p for p in chart.get("points",[]) if p["value"] is not None]
            labels=[p["label"] for p in points]; values=[p["value"] for p in points]
            if kind == "line": ax.plot(labels,values,color="#087e8b")
            else: ax.bar(labels,values,color="#087e8b")
            if not points: ax.text(.5,.5,"INSUFFICIENT DATA",ha="center",transform=ax.transAxes)
        if kind in ("line","multiline"):
            ticks=ax.get_xticks();step=max(1,len(ticks)//8);ax.set_xticks(ticks[::step])
        if kind not in ("confusion","boxplot"): ax.tick_params(axis="x",labelrotation=30)
        fig.text(.01,.01,"Operation Suite Intelligence | SYNTHETIC v0.2 | Generated from pipeline data",fontsize=7)
        safe="".join(c if c.isalnum() or c in "-_" else "_" for c in chart["id"])
        destination=figures/(safe+".svg")
        fig.savefig(destination,metadata={"Date":None})
        destination.write_text('\n'.join(line.rstrip() for line in destination.read_text(encoding='utf-8').splitlines())+'\n',encoding='utf-8')
        pdf.savefig(fig);plt.close(fig)
print("Generated",len(charts),"standalone figures and EDA_FIGURES.pdf")
if report["status"]!="PASS": raise SystemExit(1)
