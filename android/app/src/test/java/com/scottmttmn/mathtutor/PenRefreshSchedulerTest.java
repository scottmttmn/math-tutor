package com.scottmttmn.mathtutor;

import static org.junit.Assert.assertEquals;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.Test;

public class PenRefreshSchedulerTest {
    private long now;
    private int refreshCount;
    private final Map<Runnable, Long> tasks = new LinkedHashMap<>();
    private final PenRefreshScheduler refreshes = new PenRefreshScheduler(
        task -> tasks.put(task, now + 500), tasks::remove, () -> refreshCount++
    );

    private void advance(long ms) {
        now += ms;
        for (Runnable task : tasks.keySet().toArray(new Runnable[0])) {
            if (tasks.get(task) <= now) {
                tasks.remove(task);
                task.run();
            }
        }
    }

    @Test
    public void shortGapsBetweenLettersNeverInterruptWriting() {
        for (int i = 0; i < 10; i++) {
            refreshes.beginStroke();
            advance(100);
            refreshes.endStroke();
            refreshes.request();
            advance(100);
            assertEquals(0, refreshCount);
        }
        advance(400);
        assertEquals(1, refreshCount);
    }

    @Test
    public void aLongStrokeDefersAnAlreadyRequestedRefreshUntilAfterLift() {
        refreshes.request();
        advance(400);
        refreshes.beginStroke();
        advance(2000);
        refreshes.request();
        advance(2000);
        assertEquals(0, refreshCount);
        refreshes.endStroke();
        advance(499);
        assertEquals(0, refreshCount);
        advance(1);
        assertEquals(1, refreshCount);
    }

    @Test
    public void aDequeuedStaleCallbackCannotRefreshDuringTheNextStroke() {
        refreshes.request();
        Runnable stale = tasks.keySet().iterator().next();
        refreshes.beginStroke();
        stale.run();
        assertEquals(0, refreshCount);
        refreshes.endStroke();
        stale.run();
        assertEquals(0, refreshCount);
        advance(500);
        assertEquals(1, refreshCount);
    }

    @Test
    public void pauseOrStopDiscardsPendingWorkEvenIfACallbackWasDequeued() {
        refreshes.request();
        Runnable stale = tasks.keySet().iterator().next();
        refreshes.cancel();
        stale.run();
        advance(1000);
        refreshes.endStroke();
        advance(1000);
        assertEquals(0, refreshCount);
        refreshes.request();
        advance(500);
        assertEquals(1, refreshCount);
    }

    @Test
    public void pageChangesWhileIdleAreCoalesced() {
        refreshes.request();
        advance(400);
        refreshes.request();
        advance(499);
        assertEquals(0, refreshCount);
        advance(1);
        assertEquals(1, refreshCount);
    }
}
