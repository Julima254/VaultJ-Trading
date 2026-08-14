const MULTIPLIER_ORDER = [0, 0.5, 1, 1.5, 2, 5, 10];
const SEGMENT_ANGLE = 360 / MULTIPLIER_ORDER.length;

const wheel = document.getElementById("wheel");
const spinBtn = document.getElementById("spinBtn");
const stakeInput = document.getElementById("stakeInput");
const resultEl = document.getElementById("result");
const walletEl = document.getElementById("walletBalance");
const poolEl = document.getElementById("poolBalance");

let currentRotation = 0;

function angleForMultiplier(multiplier) {
  const index = MULTIPLIER_ORDER.indexOf(multiplier);
  const segmentCenter = index * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
  return 360 - segmentCenter;
}

async function spin() {
  const stake = Number(stakeInput.value);

  if (!Number.isFinite(stake) || stake < 5) {
    resultEl.textContent = "Minimum stake is KSh 5.";
    resultEl.className = "lose";
    return;
  }

  spinBtn.disabled = true;
  resultEl.textContent = "Spinning...";
  resultEl.className = "";

  try {
    const res = await fetch("/vault-jspins/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stake }),
    });

    const data = await res.json();

    if (!data.ok) {
      resultEl.textContent = data.message || "Spin failed.";
      resultEl.className = "lose";
      spinBtn.disabled = false;
      return;
    }

    const targetAngle = angleForMultiplier(data.multiplier);
    const fullSpins = 5 * 360;
    currentRotation += fullSpins + ((targetAngle - (currentRotation % 360) + 360) % 360);

    wheel.style.transform = `rotate(${currentRotation}deg)`;

    setTimeout(() => {
      try {
        if (walletEl) walletEl.textContent = data.walletBalance.toFixed(2);
        if (poolEl) poolEl.textContent = data.poolBalance.toFixed(2);

        if (data.multiplier === 0) {
          resultEl.textContent = `×0 — You lost KSh ${stake.toFixed(2)}`;
          resultEl.className = "lose";
        } else {
          resultEl.textContent = `×${data.multiplier} — You won KSh ${data.payout.toFixed(2)}!`;
          resultEl.className = "";
        }
      } catch (err) {
        console.error("Error updating spin result UI:", err);
        resultEl.textContent = "Spin complete, but display failed to update.";
        resultEl.className = "lose";
      } finally {
        spinBtn.disabled = false;
      }
    }, 4100);
  } catch (err) {
    console.error(err);
    resultEl.textContent = "Network error — please try again.";
    resultEl.className = "lose";
    spinBtn.disabled = false;
  }
}

spinBtn.addEventListener("click", spin);