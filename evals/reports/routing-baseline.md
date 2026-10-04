# Routing benchmark: baseline

Routing detectors over 86 cases

| Detector | Positives | Precision | Recall | Accuracy |
|---|---|---|---|---|
| representation | 4 | 0.8 | 1 | 0.988 |
| no-solution condition | 5 | 1 | 0.6 | 0.977 |
| integer parameters (exact set) | 8 | 1 | 0.75 | 0.977 |
| continuous interval | 3 | 1 | 1 | 1 |
| integer-factor extremum | 2 | 1 | 0.5 | 0.988 |

representation false alarms: 019-bedrock-radical-equation-choice

no-solution condition misses: 022-bedrock-quadratic-line-no-intersection; 082-hard-not-no-solution-system

integer parameters (exact set) misses: 030-bedrock-hard-two-factor-forms [j,k vs j]; 031-bedrock-hard-minimum-factor-product [a,b,c,d,k vs k]

integer-factor extremum misses: 031-bedrock-hard-minimum-factor-product
