# EDA Report — Operation Suite Intelligence v0.1

**Dataset:** synthetic, reproducible, 1440 executions. No controlled real or production records are included.

## Summary

- Data origin: {"SYNTHETIC":1440}
- Statuses: {"cancelled":40,"failure":75,"success":1325}
- Platforms: {"macos":333,"windows":1107}
- Expected synthetic anomalies: 111

## Duration by tool

| Tool | Runs | Median seconds | P95 seconds | Expected anomalies |
| --- | ---: | ---: | ---: | ---: |
| clean-vector-pro | 667 | 4.428 | 13.362 | 45 |
| sepmaker-pro | 773 | 11.881 | 38.85 | 66 |

This report is an initial reproducible EDA summary. Visual plots and a Python notebook remain pending an authorized Python environment.
