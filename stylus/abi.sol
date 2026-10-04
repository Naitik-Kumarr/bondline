interface IBondlinePricer {
    function quote(uint256 wBps, uint256 sigmaBps, uint256 termDays, uint256 limitBps, uint256 capBps) external pure returns (uint256, uint256, uint256, uint256, uint256);

    error WBpsTooLarge();

    error SigmaBpsTooLarge();

    error TermDaysOutOfRange();

    error CapBpsOutOfRange();

    error LimitBpsOutOfRange();
}
